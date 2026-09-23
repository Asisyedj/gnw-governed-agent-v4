import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { createDb } from "./db/index.js";
import { getInterlock } from "./repo.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { taskRoutes } from "./routes/tasks.js";
import { approvalRoutes } from "./routes/approvals.js";
import { interlockRoutes } from "./routes/interlock.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";
import { summaryRoutes } from "./routes/summary.js";
import { insertAuditLog } from "./repo.js";

const PORT = Number(process.env.PORT ?? 3000);
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? "change-me-in-production-must-be-32-chars-min";

export async function buildApp() {
  const db = createDb();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: true,
    disableRequestLogging: false,
  });

  // Security headers
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
  });

  // Rate limiting
  await app.register(fastifyRateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });

  // Cookies
  await app.register(fastifyCookie, { secret: COOKIE_SECRET });

  // Decorate with db
  app.decorate("db", db);

  // Global kill-switch check for mutating API paths
  app.addHook("preHandler", async (req, reply) => {
    const method = req.method;
    const path = req.url;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      // Allow auth + interlock management + health always
      const exempt = ["/api/auth", "/api/interlock", "/api/health", "/api/ready"];
      if (!exempt.some((p) => path.startsWith(p))) {
        const lock = await getInterlock(db);
        if (lock.killSwitch) {
          await insertAuditLog(db, { eventType: "kill_switch_block", outcome: "denied", detail: { path, method }, ipAddress: req.ip });
          return reply.status(503).send({ error: "Kill switch engaged — all governed actions are suspended.", code: "kill_switch" });
        }
        if (lock.circuitOpen) {
          await insertAuditLog(db, { eventType: "circuit_breaker_block", outcome: "denied", detail: { path, method }, ipAddress: req.ip });
          return reply.status(503).send({ error: "Circuit breaker open — retry after reset.", code: "circuit_open" });
        }
      }
    }
  });

  // Routes
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(summaryRoutes, { prefix: "/api" });
  await app.register(taskRoutes, { prefix: "/api/tasks" });
  await app.register(approvalRoutes, { prefix: "/api/approvals" });
  await app.register(interlockRoutes, { prefix: "/api/interlock" });
  await app.register(auditRoutes, { prefix: "/api/audit" });

  return { app, db };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { app } = await buildApp();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`GNW server listening on port ${PORT}`);
}
