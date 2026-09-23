import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { createDb, closeDb } from "./db/index.js";
import { getInterlock, insertAuditLog } from "./repo.js";
import { validateSecrets } from "./lib/secretsCheck.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { taskRoutes } from "./routes/tasks.js";
import { approvalRoutes } from "./routes/approvals.js";
import { interlockRoutes } from "./routes/interlock.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";
import { summaryRoutes } from "./routes/summary.js";

const PORT = Number(process.env.PORT ?? 3000);

export async function buildApp() {
  validateSecrets();

  const db = createDb();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(process.env.NODE_ENV !== "production"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : {}),
    },
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // ── Security headers ──────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc:    ["'self'"],
        objectSrc:  ["'none'"],
        mediaSrc:   ["'none'"],
        frameSrc:   ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: process.env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({ error: "Too many requests", code: "rate_limited", retryAfter: ctx.after }),
  });

  // ── Tighter auth rate limit ───────────────────────────────────────────────
  await app.register(async (authApp) => {
    await authApp.register(fastifyRateLimit, { max: 20, timeWindow: "15 minutes", keyGenerator: (req) => req.ip });
    await authApp.register(authRoutes, { prefix: "/api/auth" });
  });

  // ── Cookies ───────────────────────────────────────────────────────────────
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET! });

  // ── DB decoration ─────────────────────────────────────────────────────────
  app.decorate("db", db);

  // ── Kill-switch / circuit-breaker guard ───────────────────────────────────
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

  // ── Serve built client in production ──────────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    const { default: fastifyStatic } = await import("@fastify/static");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL(".", import.meta.url));
    await app.register(fastifyStatic, { root: join(dir, "../../dist/client"), prefix: "/", decorateReply: false });
    app.setNotFoundHandler(async (_req, reply) => reply.sendFile("index.html"));
  }

  // ── API routes ────────────────────────────────────────────────────────────
  await app.register(healthRoutes,   { prefix: "/api" });
  await app.register(meRoutes,       { prefix: "/api" });
  await app.register(summaryRoutes,  { prefix: "/api" });
  await app.register(taskRoutes,     { prefix: "/api/tasks" });
  await app.register(approvalRoutes, { prefix: "/api/approvals" });
  await app.register(interlockRoutes,{ prefix: "/api/interlock" });
  await app.register(auditRoutes,    { prefix: "/api/audit" });

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler(async (error, req, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error({ err: error, reqId: req.id }, "Internal server error");
    return reply.status(status).send({
      error: status >= 500 ? "Internal server error" : error.message,
      code:  (error as { code?: string }).code ?? "internal_error",
      reqId: req.id,
    });
  });

  return { app, db };
}

async function main() {
  const { app } = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down gracefully…`);
    try { await app.close(); await closeDb(); process.exit(0); }
    catch (err) { app.log.error(err, "Shutdown error"); process.exit(1); }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("uncaughtException",  (err) => { app.log.error(err, "Uncaught exception"); process.exit(1); });
  process.on("unhandledRejection", (r)   => { app.log.error({ reason: r }, "Unhandled rejection"); process.exit(1); });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`GNW server ready on :${PORT}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
