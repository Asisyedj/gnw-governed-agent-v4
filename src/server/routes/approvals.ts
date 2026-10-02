import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveSession } from "./auth.js";
import { findUserById, listPendingApprovals, findApprovalById, reviewApproval, insertAuditLog } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const reviewSchema = z.object({
  status: z.enum(["approved", "denied"]),
  reason: z.string().max(1000).optional(),
});

async function handleReview(app: { db: Db }, req: FastifyRequest, reply: FastifyReply, forcedStatus?: "approved" | "denied") {
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
  const status = forcedStatus ?? (parsed.success ? parsed.data.status : undefined);
  if (!parsed.success && !forcedStatus) return reply.status(400).send({ error: "Invalid input" });
  if (!status) return reply.status(400).send({ error: "Invalid input" });

  const reason = parsed.success ? parsed.data.reason : undefined;
  const updated = await reviewApproval(app.db, id, session.tenantId, session.userId, status, reason);
  if (!updated) return reply.status(409).send({ error: "Approval was already reviewed.", code: "already_reviewed" });

  await insertAuditLog(app.db, {
    eventType: status === "approved" ? "approval.use" : "task.deny",
    actorId: session.userId, tenantId: session.tenantId, taskId: approval.taskId ?? undefined,
    resourceType: "approval", resourceId: String(id), outcome: "success",
    detail: { reason }, ipAddress: req.ip
  });
  return reply.send({ ok: true, approval: updated });
}

export const approvalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    return reply.send(await listPendingApprovals(app.db, session.tenantId));
  });

  app.patch("/:id", async (req, reply) => handleReview(app, req, reply));
  app.post("/:id/approve", async (req, reply) => handleReview(app, req, reply, "approved"));
  app.post("/:id/deny", async (req, reply) => handleReview(app, req, reply, "denied"));
};
