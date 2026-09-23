import type { FastifyPluginAsync } from "fastify";
import { resolveSession } from "./auth.js";
import { findUserById, listAuditLog } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated" });

    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) return reply.status(401).send({ error: "Unauthenticated" });
    if (!(["owner", "admin"] as string[]).includes(user.role)) {
      return reply.status(403).send({ error: "Only owner/admin can view audit log.", code: "forbidden" });
    }

    const limit = Math.min(Number((req.query as Record<string, string>).limit ?? 100), 500);
    const offset = Number((req.query as Record<string, string>).offset ?? 0);
    const entries = await listAuditLog(app.db, session.tenantId, limit, offset);
    return reply.send(entries);
  });
};
