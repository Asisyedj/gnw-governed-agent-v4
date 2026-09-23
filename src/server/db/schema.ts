import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({ slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug) }));

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "admin", "operator", "viewer"] }).notNull().default("viewer"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  emailTenantIdx: uniqueIndex("users_email_tenant_idx").on(t.email, t.tenantId),
  tenantIdx: index("users_tenant_idx").on(t.tenantId),
}));

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  tokenIdx: uniqueIndex("sessions_token_idx").on(t.tokenHash),
  userIdx: index("sessions_user_idx").on(t.userId),
}));

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["pending", "running", "waiting_approval", "done", "failed", "cancelled"] }).notNull().default("pending"),
  classification: text("classification").notNull().default("standard"),
  budgetTokensAllocated: integer("budget_tokens_allocated").notNull().default(10000),
  budgetTokensUsed: integer("budget_tokens_used").notNull().default(0),
  budgetBytesAllocated: integer("budget_bytes_allocated").notNull().default(10485760),
  budgetBytesUsed: integer("budget_bytes_used").notNull().default(0),
  trajectoryRootHash: text("trajectory_root_hash"),
  trajectorySteps: integer("trajectory_steps").notNull().default(0),
  errorMessage: text("error_message"),
  metadata: text("metadata", { mode: "json" }),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  tenantIdx: index("tasks_tenant_idx").on(t.tenantId),
  statusIdx: index("tasks_status_idx").on(t.status),
  tenantStatusIdx: index("tasks_tenant_status_idx").on(t.tenantId, t.status),
}));

export const taskSteps = sqliteTable("task_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  stepIndex: integer("step_index").notNull(),
  agentRole: text("agent_role").notNull(),
  toolName: text("tool_name").notNull(),
  operation: text("operation").notNull(),
  inputDigest: text("input_digest").notNull(),
  outputDigest: text("output_digest"),
  status: text("status", { enum: ["pending", "running", "done", "failed", "denied"] }).notNull().default("pending"),
  governanceDecision: text("governance_decision", { mode: "json" }),
  chainHash: text("chain_hash").notNull(),
  prevChainHash: text("prev_chain_hash"),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  taskIdx: index("task_steps_task_idx").on(t.taskId),
  tenantIdx: index("task_steps_tenant_idx").on(t.tenantId),
  uniqueStep: uniqueIndex("task_steps_unique_step").on(t.taskId, t.stepIndex),
}));

export const approvals = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  taskId: integer("task_id").references(() => tasks.id),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  actionDigest: text("action_digest").notNull(),
  requestId: text("request_id"),
  nonce: text("nonce").notNull().unique(),
  status: text("status", { enum: ["pending", "approved", "denied", "expired"] }).notNull().default("pending"),
  reason: text("reason"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  tenantIdx: index("approvals_tenant_idx").on(t.tenantId),
  statusIdx: index("approvals_status_idx").on(t.status),
  nonceIdx: uniqueIndex("approvals_nonce_idx").on(t.nonce),
  digestIdx: index("approvals_digest_idx").on(t.actionDigest),
}));

export const nonces = sqliteTable("nonces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  nonce: text("nonce").notNull(),
  taskId: integer("task_id"),
  consumedAt: integer("consumed_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({ uniqueNonce: uniqueIndex("nonces_unique_idx").on(t.kind, t.nonce) }));

export const interlocks = sqliteTable("interlocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  killSwitch: integer("kill_switch", { mode: "boolean" }).notNull().default(false),
  circuitOpen: integer("circuit_open", { mode: "boolean" }).notNull().default(false),
  generation: integer("generation").notNull().default(0),
  reason: text("reason"),
  updatedByUserId: integer("updated_by_user_id"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  actorId: integer("actor_id"),
  tenantId: integer("tenant_id"),
  taskId: integer("task_id"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  outcome: text("outcome", { enum: ["success", "failure", "denied", "error"] }),
  detail: text("detail", { mode: "json" }),
  requestId: text("request_id"),
  ipAddress: text("ip_address"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  tenantIdx: index("audit_log_tenant_idx").on(t.tenantId),
  eventTypeIdx: index("audit_log_event_type_idx").on(t.eventType),
  createdAtIdx: index("audit_log_created_at_idx").on(t.createdAt),
  actorIdx: index("audit_log_actor_idx").on(t.actorId),
}));

export const budgetReservations = sqliteTable("budget_reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  grantNonce: text("grant_nonce").notNull(),
  reservedTokens: integer("reserved_tokens").notNull(),
  reservedBytes: integer("reserved_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, t => ({
  taskIdx: index("budget_res_task_idx").on(t.taskId),
  uniqueGrant: uniqueIndex("budget_res_grant_idx").on(t.taskId, t.grantNonce),
}));

export const capabilityLeases = sqliteTable("capability_leases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leaseId: text("lease_id").notNull().unique(),
  taskId: integer("task_id"),
  tenantId: integer("tenant_id"),
  actorUserId: integer("actor_user_id"),
  capability: text("capability").notNull(),
  issuedAt: integer("issued_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const artifacts = sqliteTable("artifacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  taskId: integer("task_id").references(() => tasks.id),
  stepId: integer("step_id").references(() => taskSteps.id),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
