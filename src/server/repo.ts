import { eq, and, desc, asc, sql, lt } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { schema } from "./db/index.js";
import type { Interlock } from "./governance.js";
import { randomUUID } from "node:crypto";

const { tenants, users, sessions, tasks, taskSteps, approvals, nonces, interlocks, auditLog, budgetReservations, artifacts } = schema;

/* ─── Tenants ─── */
export async function findTenantBySlug(db: Db, slug: string) {
  return db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
}
export async function createTenant(db: Db, slug: string, displayName: string) {
  const [row] = await db.insert(tenants).values({ slug, displayName }).returning();
  return row!;
}

/* ─── Users ─── */
export async function findUserByEmail(db: Db, tenantId: number, email: string) {
  return db.query.users.findFirst({ where: and(eq(users.email, email.trim().toLowerCase()), eq(users.tenantId, tenantId)) });
}
export async function findUserById(db: Db, id: number, tenantId: number) {
  return db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.tenantId, tenantId)) });
}
export async function countUsersByTenant(db: Db, tenantId: number) {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId));
  return Number(row?.count ?? 0);
}
export async function createUser(db: Db, input: { tenantId: number; email: string; passwordHash: string; role?: "owner" | "admin" | "operator" | "viewer" }) {
  const [row] = await db.insert(users).values({ tenantId: input.tenantId, email: input.email.trim().toLowerCase(), passwordHash: input.passwordHash, role: input.role ?? "viewer" }).returning();
  return row!;
}
export async function updateUserLastLogin(db: Db, userId: number) {
  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
}
export async function listUsersByTenant(db: Db, tenantId: number) {
  return db.query.users.findMany({ where: eq(users.tenantId, tenantId), orderBy: asc(users.id) });
}

/* ─── Sessions ─── */
export async function createSession(db: Db, userId: number, tenantId: number, tokenHash: string, expiresAt: Date) {
  const [row] = await db.insert(sessions).values({ id: randomUUID(), userId, tenantId, tokenHash, expiresAt }).returning();
  return row!;
}
export async function findSessionByTokenHash(db: Db, tokenHash: string) {
  return db.query.sessions.findFirst({ where: eq(sessions.tokenHash, tokenHash) });
}
export async function deleteSession(db: Db, id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}
export async function deleteExpiredSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/* ─── Tasks ─── */
export async function createTask(db: Db, input: { tenantId: number; createdByUserId: number; title: string; description?: string; classification?: string; budgetTokensAllocated?: number; budgetBytesAllocated?: number; metadata?: unknown }) {
  const [row] = await db.insert(tasks).values({
    tenantId: input.tenantId, createdByUserId: input.createdByUserId,
    title: input.title, description: input.description ?? null,
    classification: input.classification ?? "standard",
    budgetTokensAllocated: input.budgetTokensAllocated ?? 10000,
    budgetBytesAllocated: input.budgetBytesAllocated ?? 10485760,
    metadata: (input.metadata as string | null) ?? null,
  }).returning();
  return row!;
}
export async function findTaskById(db: Db, id: number, tenantId: number) {
  return db.query.tasks.findFirst({ where: and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)) });
}
export async function listTasksByTenant(db: Db, tenantId: number, limit = 50, offset = 0) {
  return db.query.tasks.findMany({ where: eq(tasks.tenantId, tenantId), orderBy: desc(tasks.createdAt), limit, offset });
}
export async function updateTaskStatus(db: Db, id: number, tenantId: number, status: "pending" | "running" | "waiting_approval" | "done" | "failed" | "cancelled", errorMessage?: string) {
  await db.update(tasks).set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date(), ...(status === "running" ? { startedAt: new Date() } : {}), ...(["done", "failed", "cancelled"].includes(status) ? { completedAt: new Date() } : {}) }).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)));
}
export async function incrementTaskBudgetUsed(db: Db, id: number, tenantId: number, tokens: number, bytes: number) {
  await db.update(tasks).set({ budgetTokensUsed: sql`${tasks.budgetTokensUsed} + ${tokens}`, budgetBytesUsed: sql`${tasks.budgetBytesUsed} + ${bytes}`, updatedAt: new Date() }).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)));
}
export async function updateTaskTrajectory(db: Db, id: number, tenantId: number, rootHash: string, steps: number) {
  await db.update(tasks).set({ trajectoryRootHash: rootHash, trajectorySteps: steps, updatedAt: new Date() }).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)));
}

/* ─── Task Steps ─── */
export async function createTaskStep(db: Db, input: { taskId: number; tenantId: number; stepIndex: number; agentRole: string; toolName: string; operation: string; inputDigest: string; chainHash: string; prevChainHash?: string | null }) {
  const [row] = await db.insert(taskSteps).values({ ...input, prevChainHash: input.prevChainHash ?? null }).returning();
  return row!;
}
export async function updateTaskStep(db: Db, id: number, tenantId: number, update: { outputDigest?: string; status?: "pending" | "running" | "done" | "failed" | "denied"; governanceDecision?: unknown; durationMs?: number; errorMessage?: string }) {
  await db.update(taskSteps).set({ ...update, updatedAt: new Date() } as Record<string, unknown>).where(and(eq(taskSteps.id, id), eq(taskSteps.tenantId, tenantId)));
}
export async function listTaskSteps(db: Db, taskId: number, tenantId: number) {
  return db.query.taskSteps.findMany({ where: and(eq(taskSteps.taskId, taskId), eq(taskSteps.tenantId, tenantId)), orderBy: asc(taskSteps.stepIndex) });
}

/* ─── Approvals ─── */
export async function createApproval(db: Db, input: { tenantId: number; taskId?: number; requestedByUserId?: number; actionDigest: string; requestId?: string; expiresAt: Date }) {
  const [row] = await db.insert(approvals).values({ tenantId: input.tenantId, taskId: input.taskId ?? null, requestedByUserId: input.requestedByUserId ?? null, actionDigest: input.actionDigest, requestId: input.requestId ?? null, nonce: randomUUID(), expiresAt: input.expiresAt }).returning();
  return row!;
}
export async function findApprovalById(db: Db, id: number, tenantId: number) {
  return db.query.approvals.findFirst({ where: and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)) });
}
export async function findPendingApprovalByDigest(db: Db, tenantId: number, actionDigest: string) {
  return db.query.approvals.findFirst({ where: and(eq(approvals.tenantId, tenantId), eq(approvals.actionDigest, actionDigest), eq(approvals.status, "pending")) });
}
export async function listPendingApprovals(db: Db, tenantId: number) {
  return db.query.approvals.findMany({ where: and(eq(approvals.tenantId, tenantId), eq(approvals.status, "pending")), orderBy: asc(approvals.createdAt) });
}
export async function reviewApproval(db: Db, id: number, tenantId: number, reviewedByUserId: number, status: "approved" | "denied", reason?: string) {
  const [row] = await db.update(approvals).set({ status, reason: reason ?? null, reviewedByUserId, reviewedAt: new Date() }).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId))).returning();
  return row;
}

/* ─── Nonces ─── */
export async function claimNonce(db: Db, kind: string, nonce: string, taskId?: number): Promise<boolean> {
  try { await db.insert(nonces).values({ kind, nonce, taskId: taskId ?? null }); return true; } catch { return false; }
}

/* ─── Interlocks ─── */
export async function getInterlock(db: Db): Promise<Interlock> {
  const row = await db.query.interlocks.findFirst({ orderBy: desc(interlocks.updatedAt) });
  return row ?? { killSwitch: false, circuitOpen: false, generation: 0 };
}
export async function setInterlock(db: Db, patch: Partial<Interlock>, updatedByUserId?: number) {
  const current = await getInterlock(db);
  const [row] = await db.insert(interlocks).values({ killSwitch: patch.killSwitch ?? current.killSwitch, circuitOpen: patch.circuitOpen ?? current.circuitOpen, generation: (current.generation ?? 0) + 1, updatedByUserId: updatedByUserId ?? null }).returning();
  return row!;
}

/* ─── Budget Reservations ─── */
export async function reserveBudget(db: Db, taskId: number, grantNonce: string, tokens: number, bytes: number): Promise<boolean> {
  try { await db.insert(budgetReservations).values({ taskId, grantNonce, reservedTokens: tokens, reservedBytes: bytes }); return true; } catch { return false; }
}

/* ─── Audit Log ─── */
export async function insertAuditLog(db: Db, entry: { eventType: string; actorId?: number; tenantId?: number; taskId?: number; resourceType?: string; resourceId?: string; outcome?: "success" | "failure" | "denied" | "error"; detail?: unknown; requestId?: string; ipAddress?: string }) {
  await db.insert(auditLog).values({ ...entry, detail: (entry.detail as string | null) ?? null });
}
export async function listAuditLog(db: Db, tenantId: number, limit = 100, offset = 0) {
  return db.query.auditLog.findMany({ where: eq(auditLog.tenantId, tenantId), orderBy: desc(auditLog.createdAt), limit, offset });
}

/* ─── Artifacts ─── */
export async function createArtifact(db: Db, input: { tenantId: number; taskId?: number; stepId?: number; storageKey: string; filename: string; contentType: string; size: number; sha256: string }) {
  const [row] = await db.insert(artifacts).values({ tenantId: input.tenantId, taskId: input.taskId ?? null, stepId: input.stepId ?? null, storageKey: input.storageKey, filename: input.filename, contentType: input.contentType, size: input.size, sha256: input.sha256 }).returning();
  return row!;
}
export async function listArtifacts(db: Db, taskId: number, tenantId: number) {
  return db.query.artifacts.findMany({ where: and(eq(artifacts.taskId, taskId), eq(artifacts.tenantId, tenantId)) });
}
