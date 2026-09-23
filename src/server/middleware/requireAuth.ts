import type { FastifyRequest, FastifyReply } from "fastify";
import { resolveSession } from "../routes/auth.js";
import type { Db } from "../db/index.js";
import { findUserById } from "../repo.js";

export type AuthenticatedRequest = FastifyRequest & {
  session: { id: string; userId: number; tenantId: number };
  actor: { id: number; email: string; role: string; tenantId: number };
};

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Db,
  minRole?: "viewer" | "operator" | "admin" | "owner"
): Promise<{ userId: number; tenantId: number; role: string } | null> {
  const session = await resolveSession(db, req.cookies as Record<string, string>);
  if (!session) {
    await reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    return null;
  }
  const user = await findUserById(db, session.userId, session.tenantId);
  if (!user) {
    await reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    return null;
  }
  const roleRank: Record<string, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };
  if (minRole && (roleRank[user.role] ?? -1) < (roleRank[minRole] ?? 0)) {
    await reply.status(403).send({ error: "Insufficient permissions.", code: "forbidden", required: minRole, actual: user.role });
    return null;
  }
  return { userId: user.id, tenantId: user.tenantId, role: user.role };
}
