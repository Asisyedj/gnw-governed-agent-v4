import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { resolveSession } from './auth.js';
import { findUserById,listPendingApprovals,findApprovalById,reviewApproval,insertAuditLog } from '../repo.js';
import type { Db } from '../db/index.js';

declare module 'fastify' { interface FastifyInstance { db: Db; } }
const reviewSchema = z.object({ status: z.enum(['approved','denied']), reason: z.string().max(1000).optional() });

async function requireReviewer(app: { db: Db }, req: any, reply: any) {
  const session = await resolveSession(app.db, req.cookies as Record<string, string>);
  if (!session) { reply.status(401).send({ error: 'Unauthenticated', code: 'unauthenticated' }); return null; }
  const user = await findUserById(app.db, session.userId, session.tenantId);
  if (!user) { reply.status(401).send({ error: 'Unauthenticated', code: 'unauthenticated' }); return null; }
  if (!['owner','admin'].includes(user.role)) { reply.status(403).send({ error: 'Only owner/admin can review approvals.', code: 'forbidden' }); return null; }
  return { session, user };
}

export const approvalRoutes: FastifyPluginAsync = async app => {
  app.get('/', async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: 'Unauthenticated', code: 'unauthenticated' });
    return reply.send(await listPendingApprovals(app.db, session.tenantId));
  });

  const performReview = async (req: any, reply: any, forcedStatus?: 'approved'|'denied') => {
    const actor = await requireReviewer(app, req, reply);
    if (!actor) return reply;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Invalid approval ID' });

    const parsed = forcedStatus
      ? { success: true as const, data: { status: forcedStatus, ...(req.body?.reason !== undefined ? { reason: req.body.reason } : {}) } }
      : reviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const current = await findApprovalById(app.db, id, actor.session.tenantId);
    if (!current) return reply.status(404).send({ error: 'Approval not found' });
    if (current.status !== 'pending') return reply.status(409).send({ error: 'Approval already ' + current.status + '.' });
    if (current.expiresAt <= new Date()) return reply.status(410).send({ error: 'Approval request has expired.', code: 'expired' });

    const updated = parsed.data.reason === undefined
      ? await reviewApproval(app.db,id,actor.session.tenantId,actor.session.userId,parsed.data.status)
      : await reviewApproval(app.db,id,actor.session.tenantId,actor.session.userId,parsed.data.status,parsed.data.reason);
    if (!updated) return reply.status(409).send({ error: 'Approval was already reviewed by another request.', code: 'approval_race' });

    const event: any = {
      eventType: 'approval.' + parsed.data.status,
      actorId: actor.session.userId,
      tenantId: actor.session.tenantId,
      resourceType: 'approval',
      resourceId: String(id),
      outcome: 'success',
      ipAddress: req.ip,
    };
    if (current.taskId !== null && current.taskId !== undefined) event.taskId = current.taskId;
    if (parsed.data.reason !== undefined) event.detail = { reason: parsed.data.reason };
    await insertAuditLog(app.db, event);
    return reply.send({ ok: true, approval: updated });
  };

  app.patch('/:id', async (req, reply) => performReview(req, reply));
  app.post('/:id/approve', async (req, reply) => performReview(req, reply, 'approved'));
  app.post('/:id/deny', async (req, reply) => performReview(req, reply, 'denied'));
};
