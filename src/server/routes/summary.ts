import type { FastifyPluginAsync } from "fastify";
import { resolveSession } from "./auth.js";
import { findUserById, listTasksByTenant, listPendingApprovals, getInterlock } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });

    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });

    const [tasks, approvals, interlock] = await Promise.all([
      listTasksByTenant(app.db, session.tenantId, 50, 0),
      listPendingApprovals(app.db, session.tenantId),
      getInterlock(app.db),
    ]);

    const stats = {
      total: tasks.length,
      running: tasks.filter(t => t.status === "running").length,
      done: tasks.filter(t => t.status === "done").length,
      failed: tasks.filter(t => t.status === "failed").length,
    };

    return reply.send({ tasks, approvals, interlock, stats });
  });
};
