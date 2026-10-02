import { eq, and, desc, asc, sql, lt } from "drizzle-orm";
import { withTenant, type Db } from "./db/index.js";
import { schema } from "./db/index.js";
import type { Interlock } from "./governance.js";
import { randomUUID } from "node:crypto";

const { tenants, users, sessions, tasks, taskSteps, approvals, nonces, interlocks, auditLog, budgetReservations, artifacts, capabilityLeases } = schema;

export async function findTenantBySlug(db: Db, slug: string) { const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1); return row; }
export async function createTenant(db: Db, slug: string, displayName: string) { const [row] = await db.insert(tenants).values({ slug, displayName }).returning(); return row!; }

export async function findUserByEmail(db: Db, tenantId: number, email: string) { return withTenant(db, tenantId, async tx => { const [row] = await tx.select().from(users).where(and(eq(users.email, email.trim().toLowerCase()), eq(users.tenantId, tenantId))).limit(1); return row; }); }
export async function findUserById(db: Db, id: number, tenantId: number) { return withTenant(db, tenantId, async tx => { const [row] = await tx.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId))).limit(1); return row; }); }
export async function countUsersByTenant(db: Db, tenantId: number) { return withTenant(db, tenantId, async tx => { const [row] = await tx.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)); return Number(row?.count ?? 0); }); }
export async function createUser(db: Db, input: { tenantId: number; email: string; passwordHash: string; role?: "owner" | "admin" | "operator" | "viewer" }) { return withTenant(db, input.tenantId, async tx => { const [row] = await tx.insert(users).values({ tenantId: input.tenantId, email: input.email.trim().toLowerCase(), passwordHash: input.passwordHash, role: input.role ?? "viewer" }).returning(); return row!; }); }
export async function updateUserLastLogin(db: Db, userId: number, tenantId: number) { await withTenant(db, tenantId, tx => tx.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))); }
export async function listUsersByTenant(db: Db, tenantId: number) { return withTenant(db, tenantId, tx => tx.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(asc(users.id))); }

export async function createSession(db: Db, userId: number, tenantId: number, tokenHash: string, expiresAt: Date) { const [row] = await db.insert(sessions).values({ id: randomUUID(), userId, tenantId, tokenHash, expiresAt }).returning(); return row!; }
export async function findSessionByTokenHash(db: Db, tokenHash: string) { return db.query.sessions.findFirst({ where: eq(sessions.tokenHash, tokenHash) }); }
export async function deleteSession(db: Db, id: string, tenantId?: number) { await db.delete(sessions).where(tenantId === undefined ? eq(sessions.id, id) : and(eq(sessions.id, id), eq(sessions.tenantId, tenantId))); }
export async function deleteExpiredSessions(db: Db) { await db.delete(sessions).where(lt(sessions.expiresAt, new Date())); }

export async function createTask(db: Db, input: { tenantId: number; createdByUserId: number; title: string; description?: string; classification?: string; budgetTokensAllocated?: number; budgetBytesAllocated?: number; metadata?: unknown }) { return withTenant(db, input.tenantId, async tx => { const [row] = await tx.insert(tasks).values({ tenantId: input.tenantId, createdByUserId: input.createdByUserId, title: input.title, description: input.description ?? null, classification: input.classification ?? "standard", budgetTokensAllocated: input.budgetTokensAllocated ?? 10000, budgetBytesAllocated: input.budgetBytesAllocated ?? 10485760, metadata: input.metadata ?? null }).returning(); return row!; }); }
export async function findTaskById(db: Db, id: number, tenantId: number) { return withTenant(db, tenantId, async tx => { const [row] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).limit(1); return row; }); }
export async function listTasksByTenant(db: Db, tenantId: number, limit = 50, offset = 0) { return withTenant(db, tenantId, tx => tx.select().from(tasks).where(eq(tasks.tenantId, tenantId)).orderBy(desc(tasks.createdAt)).limit(limit).offset(offset)); }
export async function updateTaskStatus(db: Db, id: number, tenantId: number, status: "pending" | "running" | "waiting_approval" | "done" | "failed" | "cancelled", errorMessage?: string) { await withTenant(db, tenantId, tx => tx.update(tasks).set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date(), ...(status === "running" ? { startedAt: new Date() } : {}), ...(["done","failed","cancelled"].includes(status) ? { completedAt: new Date() } : {}) }).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId)))); }
export async function incrementTaskBudgetUsed(db: Db, id: number, tenantId: number, tokens: number, bytes: number) { if(tokens<0||bytes<0) throw new Error("negative_budget_increment"); await withTenant(db, tenantId, async tx => { const [task] = await tx.select({ tokenUsed: tasks.budgetTokensUsed, byteUsed: tasks.budgetBytesUsed, tokenLimit: tasks.budgetTokensAllocated, byteLimit: tasks.budgetBytesAllocated }).from(tasks).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId))).for("update"); if(!task || task.tokenUsed+tokens>task.tokenLimit || Number(task.byteUsed)+bytes>Number(task.byteLimit)) throw new Error("budget_exhausted"); await tx.update(tasks).set({ budgetTokensUsed: task.tokenUsed+tokens, budgetBytesUsed: Number(task.byteUsed)+bytes, updatedAt: new Date() }).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId))); }); }
export async function updateTaskTrajectory(db: Db, id: number, tenantId: number, rootHash: string, steps: number) { await withTenant(db, tenantId, tx => tx.update(tasks).set({ trajectoryRootHash: rootHash, trajectorySteps: steps, updatedAt: new Date() }).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId)))); }

export async function createTaskStep(db: Db, input: { taskId: number; tenantId: number; stepIndex: number; agentRole: string; toolName: string; operation: string; inputDigest: string; chainHash: string; prevChainHash?: string | null }) { return withTenant(db, input.tenantId, async tx => { const [row] = await tx.insert(taskSteps).values({ ...input, prevChainHash: input.prevChainHash ?? null }).returning(); return row!; }); }
export async function updateTaskStep(db: Db, id: number, tenantId: number, update: { outputDigest?: string; status?: "pending" | "running" | "done" | "failed" | "denied"; governanceDecision?: unknown; durationMs?: number; errorMessage?: string }) { await withTenant(db, tenantId, tx => tx.update(taskSteps).set({ ...update, updatedAt: new Date() }).where(and(eq(taskSteps.id,id),eq(taskSteps.tenantId,tenantId)))); }
export async function listTaskSteps(db: Db, taskId: number, tenantId: number) { return withTenant(db, tenantId, tx => tx.select().from(taskSteps).where(and(eq(taskSteps.taskId,taskId),eq(taskSteps.tenantId,tenantId))).orderBy(asc(taskSteps.stepIndex))); }

export async function createApproval(db: Db, input: { tenantId: number; taskId?: number; requestedByUserId?: number; actionDigest: string; requestId?: string; expiresAt: Date }) { return withTenant(db, input.tenantId, async tx => { const [row] = await tx.insert(approvals).values({ tenantId: input.tenantId, taskId: input.taskId ?? null, requestedByUserId: input.requestedByUserId ?? null, actionDigest: input.actionDigest, requestId: input.requestId ?? null, nonce: randomUUID(), expiresAt: input.expiresAt }).returning(); return row!; }); }
export async function findApprovalById(db: Db, id: number, tenantId: number) { return withTenant(db, tenantId, async tx => { const [row] = await tx.select().from(approvals).where(and(eq(approvals.id,id),eq(approvals.tenantId,tenantId))).limit(1); return row; }); }
export async function findPendingApprovalByDigest(db: Db, tenantId: number, actionDigest: string) { return withTenant(db, tenantId, async tx => { const [row] = await tx.select().from(approvals).where(and(eq(approvals.tenantId,tenantId),eq(approvals.actionDigest,actionDigest),eq(approvals.status,"pending"))).limit(1); return row; }); }
export async function listPendingApprovals(db: Db, tenantId: number) { return withTenant(db, tenantId, tx => tx.select().from(approvals).where(and(eq(approvals.tenantId,tenantId),eq(approvals.status,"pending"))).orderBy(asc(approvals.createdAt))); }
export async function reviewApproval(db: Db, id: number, tenantId: number, reviewedByUserId: number, status: "approved" | "denied", reason?: string) { return withTenant(db, tenantId, async tx => { const [row] = await tx.update(approvals).set({ status, reason: reason ?? null, reviewedByUserId, reviewedAt: new Date() }).where(and(eq(approvals.id,id),eq(approvals.tenantId,tenantId),eq(approvals.status,"pending"))).returning(); return row; }); }

export async function claimNonce(db: Db, kind: string, nonce: string, taskId?: number): Promise<boolean> { try { await db.insert(nonces).values({ kind, nonce, taskId: taskId ?? null }); return true; } catch { return false; } }

export async function getInterlock(db: Db): Promise<Interlock> { const [row] = await db.select().from(interlocks).orderBy(desc(interlocks.updatedAt)).limit(1); return row ?? { killSwitch:false, circuitOpen:false, generation:0 }; }
export async function setInterlock(db: Db, patch: Partial<Interlock>, updatedByUserId?: number) { const current = await getInterlock(db); const [row] = await db.insert(interlocks).values({ killSwitch: patch.killSwitch ?? current.killSwitch, circuitOpen: patch.circuitOpen ?? current.circuitOpen, generation: (current.generation ?? 0) + 1, updatedByUserId: updatedByUserId ?? null }).returning(); return row!; }

export async function reserveBudget(db: Db, tenantId: number, taskId: number, grantNonce: string, tokens: number, bytes: number): Promise<boolean> {
  if (tokens <= 0 || bytes <= 0) return false;
  try {
    return await withTenant(db, tenantId, async tx => {
      const [task] = await tx.select({
        tokenUsed: tasks.budgetTokensUsed, byteUsed: tasks.budgetBytesUsed,
        tokenLimit: tasks.budgetTokensAllocated, byteLimit: tasks.budgetBytesAllocated
      }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId))).for("update");
      if (!task) return false;
      const [used] = await tx.select({
        tokens: sql<number>`coalesce(sum(${budgetReservations.reservedTokens}),0)`,
        bytes: sql<number>`coalesce(sum(${budgetReservations.reservedBytes}),0)`
      }).from(budgetReservations).where(and(eq(budgetReservations.tenantId, tenantId), eq(budgetReservations.taskId, taskId)));
      if (Number(used?.tokens ?? 0) + tokens > task.tokenLimit - task.tokenUsed) return false;
      if (Number(used?.bytes ?? 0) + bytes > Number(task.byteLimit) - Number(task.byteUsed)) return false;
      await tx.insert(budgetReservations).values({ tenantId, taskId, grantNonce, reservedTokens: tokens, reservedBytes: bytes });
      return true;
    });
  } catch { return false; }
}

export async function insertAuditLog(db: Db, entry: { eventType: string; actorId?: number; tenantId?: number; taskId?: number; resourceType?: string; resourceId?: string; outcome?: "success" | "failure" | "denied" | "error"; detail?: unknown; requestId?: string; ipAddress?: string }) { if(entry.tenantId===undefined){ await db.insert(auditLog).values({ ...entry, detail: entry.detail ?? null }); return; } await withTenant(db, entry.tenantId, tx => tx.insert(auditLog).values({ ...entry, detail: entry.detail ?? null })); }
export async function listAuditLog(db: Db, tenantId: number, limit = 100, offset = 0) { return withTenant(db, tenantId, tx => tx.query.auditLog.findMany({ where: eq(auditLog.tenantId,tenantId), orderBy: desc(auditLog.createdAt), limit, offset })); }

export async function createCapabilityLease(db: Db, input: { leaseId: string; requestId: string; actionDigest: string; subject: string; taskId: number; tenantId: number; actorUserId: number; capability: string; destination?: string | null; interlockGeneration: number; issuer: string; signature: string; issuedAt: Date; expiresAt: Date }) { return withTenant(db, input.tenantId, async tx => { const values = { leaseId: input.leaseId, requestId: input.requestId, actionDigest: input.actionDigest, subject: input.subject, taskId: input.taskId, tenantId: input.tenantId, actorUserId: input.actorUserId, capability: input.capability, destination: input.destination ?? null, interlockGeneration: input.interlockGeneration, issuer: input.issuer, signature: input.signature, issuedAt: input.issuedAt, expiresAt: input.expiresAt }; const [row] = await tx.insert(capabilityLeases).values(values).returning(); return row!; }); }
export async function consumeCapabilityLease(db: Db, input: { leaseId: string; tenantId: number; taskId: number; actorUserId: number; actionDigest: string; interlockGeneration: number }) { return withTenant(db, input.tenantId, async tx => { const [row] = await tx.update(capabilityLeases).set({ consumedAt: new Date() }).where(and(eq(capabilityLeases.leaseId,input.leaseId),eq(capabilityLeases.tenantId,input.tenantId),eq(capabilityLeases.taskId,input.taskId),eq(capabilityLeases.actorUserId,input.actorUserId),eq(capabilityLeases.actionDigest,input.actionDigest),eq(capabilityLeases.interlockGeneration,input.interlockGeneration),sql`${capabilityLeases.consumedAt} IS NULL`,sql`${capabilityLeases.revokedAt} IS NULL`,sql`${capabilityLeases.expiresAt} > NOW()`)).returning(); return Boolean(row); }); }
export async function createArtifact(db: Db, input: { tenantId: number; taskId?: number; stepId?: number; storageKey: string; filename: string; contentType: string; size: number; sha256: string }) { return withTenant(db, input.tenantId, async tx => { const [row] = await tx.insert(artifacts).values({ tenantId:input.tenantId, taskId:input.taskId??null, stepId:input.stepId??null, storageKey:input.storageKey, filename:input.filename, contentType:input.contentType, size:input.size, sha256:input.sha256 }).returning(); return row!; }); }
export async function listArtifacts(db: Db, taskId: number, tenantId: number) { return withTenant(db, tenantId, tx => tx.query.artifacts.findMany({ where: and(eq(artifacts.taskId,taskId),eq(artifacts.tenantId,tenantId)) })); }
