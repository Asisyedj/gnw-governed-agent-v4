import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { createDb, closeDb } from "./db/index.js";
import { getInterlock, insertAuditLog } from "./repo.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { taskRoutes } from "./routes/tasks.js";
import { approvalRoutes } from "./routes/approvals.js";
import { interlockRoutes } from "./routes/interlock.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";
import { summaryRoutes } from "./routes/summary.js";

const PORT = Number(process.env.PORT ?? 3000);
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) {
  throw new Error("COOKIE_SECRET must be set and at least 32 characters.");
}

export async function buildApp() {
  const db = createDb();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { transport: { target: "pino-pretty", options: { colorize: true } } }),
    },
    trustProxy: true,
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      error: "Too many requests",
      code: "rate_limited",
      retryAfter: context.after,
    }),
  });

  await app.register(fastifyCookie, { secret: COOKIE_SECRET });

  app.decorate("db", db);

  // Kill-switch / circuit-breaker guard on all mutating routes
  app.addHook("preHandler", async (req, reply) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const exempt = ["/api/auth", "/api/interlock", "/api/health", "/api/ready"];
      if (!exempt.some((p) => req.url.startsWith(p))) {
        const lock = await getInterlock(db);
        if (lock.killSwitch) {
          await insertAuditLog(db, { eventType: "kill_switch_block", outcome: "denied", detail: { path: req.url, method: req.method }, ipAddress: req.ip });
          return reply.status(503).send({ error: "Kill switch engaged — all governed actions are suspended.", code: "kill_switch" });
        }
        if (lock.circuitOpen) {
          await insertAuditLog(db, { eventType: "circuit_breaker_block", outcome: "denied", detail: { path: req.url, method: req.method }, ipAddress: req.ip });
          return reply.status(503).send({ error: "Circuit breaker open — retry after reset.", code: "circuit_open" });
        }
      }
    }
  });

  // Serve built client in production
  if (process.env.NODE_ENV === "production") {
    const { default: fastifyStatic } = await import("@fastify/static");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    await app.register(fastifyStatic, {
      root: join(__dirname, "../../dist/client"),
      prefix: "/",
      decorateReply: false,
    });
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile("index.html");
    });
  }

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes,   { prefix: "/api/auth" });
  await app.register(meRoutes,     { prefix: "/api" });
  await app.register(summaryRoutes,{ prefix: "/api" });
  await app.register(taskRoutes,   { prefix: "/api/tasks" });
  await app.register(approvalRoutes,{ prefix: "/api/approvals" });
  await app.register(interlockRoutes,{ prefix: "/api/interlock" });
  await app.register(auditRoutes,  { prefix: "/api/audit" });

  return { app, db };
}

// Graceful shutdown
async function main() {
  const { app } = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully…`);
    try {
      await app.close();
      await closeDb();
      app.log.info("Shutdown complete.");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    app.log.error(err, "Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    app.log.error({ reason }, "Unhandled rejection");
    process.exit(1);
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`GNW server ready on port ${PORT}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
