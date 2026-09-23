import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveSession } from "./auth.js";
import { findUserById, listPendingApprovals, findApprovalById, reviewApproval, insertAuditLog } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const reviewSchema = z.object({
  status: z.enum(["approved", "denied"]),
  reason: z.string().max(1000).optional(),
});

export const approvalRoutes: FastifyPluginAsync = async (app) => {
  // List pending approvals
  app.get("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    const approvals = await listPendingApprovals(app.db, session.tenantId);
    return reply.send(approvals);
  });

  // Review approval
  app.patch("/:id", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });

    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) return reply.status(401).send({ error: "Unauthenticated" });
    if (!(["owner", "admin"] as string[]).includes(user.role)) {
      return reply.status(403).send({ error: "Only owner/admin can review approvals.", code: "forbidden" });
    }

    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.status(400).send({ error: "Invalid approval ID" });

    const approval = await findApprovalById(app.db, id, session.tenantId);
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") return reply.status(409).send({ error: `Approval already ${approval.status}.` });
    if (approval.expiresAt < new Date()) return reply.status(410).send({ error: "Approval request has expired.", code: "expired" });

    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid input" });

    const updated = await reviewApproval(app.db, id, session.tenantId, session.userId, parsed.data.status, parsed.data.reason);
    await insertAuditLog(app.db, { eventType: `approval.${parsed.data.status}`, actorId: session.userId, tenantId: session.tenantId, taskId: approval.taskId ?? undefined, resourceType: "approval", resourceId: String(id), outcome: "success", detail: { reason: parsed.data.reason }, ipAddress: req.ip });
    return reply.send({ ok: true, approval: updated });
  });
};
