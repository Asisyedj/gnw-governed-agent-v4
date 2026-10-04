import { pgTable, serial, integer, bigint, boolean, text, timestamp, jsonb, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => ({ slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug) }));

export const users = pgTable("users", {
  id: serial("id").primaryKey(), tenantId: integer("tenant_id").notNull().references(() => tenants.id,{onDelete:"cascade"}), email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(), role: text("role",{enum:["owner","admin","operator","viewer"]}).notNull().default("viewer"),
  isActive: boolean("is_active").notNull().default(true), lastLoginAt: ts("last_login_at"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => ({ emailTenantIdx: uniqueIndex("users_email_tenant_idx").on(t.email,t.tenantId), idTenantIdx:uniqueIndex("users_id_tenant_uq").on(t.id,t.tenantId), tenantIdx:index("users_tenant_idx").on(t.tenantId) }));

export const sessions = pgTable("sessions", {
  id:text("id").primaryKey(), userId:integer("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}), tenantId:integer("tenant_id").notNull(),
  tokenHash:text("token_hash").notNull().unique(), expiresAt:ts("expires_at").notNull(), createdAt:ts("created_at").notNull().defaultNow(),
}, t => ({ tenantUserFk:foreignKey({name:"sessions_user_same_tenant_fk",columns:[t.userId,t.tenantId],foreignColumns:[users.id,users.tenantId]}) }));

export const tasks = pgTable("tasks", {
  id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull().references(()=>tenants.id,{onDelete:"cascade"}), createdByUserId:integer("created_by_user_id").references(()=>users.id),
  title:text("title").notNull(), description:text("description"), classification:text("classification").notNull().default("standard"),
  status:text("status",{enum:["pending","running","waiting_approval","done","failed","cancelled"]}).notNull().default("pending"),
  budgetTokensAllocated:integer("budget_tokens_allocated").notNull().default(10000), budgetTokensUsed:integer("budget_tokens_used").notNull().default(0),
  budgetBytesAllocated:bigint("budget_bytes_allocated",{mode:"number"}).notNull().default(10485760), budgetBytesUsed:bigint("budget_bytes_used",{mode:"number"}).notNull().default(0),
  trajectoryRootHash:text("trajectory_root_hash"), trajectorySteps:integer("trajectory_steps").notNull().default(0), errorMessage:text("error_message"), metadata:jsonb("metadata"),
  startedAt:ts("started_at"), completedAt:ts("completed_at"), createdAt:ts("created_at").notNull().defaultNow(), updatedAt:ts("updated_at").notNull().defaultNow(),
}, t => ({ tenantIdx:index("tasks_tenant_id_idx").on(t.tenantId), idTenantIdx:uniqueIndex("tasks_id_tenant_uq").on(t.id,t.tenantId), statusIdx:index("tasks_status_idx").on(t.status), createdIdx:index("tasks_created_at_idx").on(t.createdAt), creatorTenantFk:foreignKey({name:"tasks_creator_same_tenant_fk",columns:[t.createdByUserId,t.tenantId],foreignColumns:[users.id,users.tenantId]}) }));

export const taskSteps = pgTable("task_steps", {
  id:serial("id").primaryKey(), taskId:integer("task_id").notNull().references(()=>tasks.id,{onDelete:"cascade"}), tenantId:integer("tenant_id").notNull(),
  stepIndex:integer("step_index").notNull(), agentRole:text("agent_role").notNull(), toolName:text("tool_name").notNull(), operation:text("operation").notNull(),
  inputDigest:text("input_digest").notNull(), outputDigest:text("output_digest"), status:text("status",{enum:["pending","running","done","failed","denied"]}).notNull().default("pending"),
  governanceDecision:jsonb("governance_decision"), chainHash:text("chain_hash").notNull(), prevChainHash:text("prev_chain_hash"), durationMs:integer("duration_ms"), errorMessage:text("error_message"),
  createdAt:ts("created_at").notNull().defaultNow(), updatedAt:ts("updated_at").notNull().defaultNow(),
}, t => ({ taskIdx:index("task_steps_task_id_idx").on(t.taskId), tenantIdx:index("task_steps_tenant_id_idx").on(t.tenantId), idTenantIdx:uniqueIndex("task_steps_id_tenant_uq").on(t.id,t.tenantId), uniqueStep:uniqueIndex("task_steps_unique_step").on(t.taskId,t.stepIndex), taskTenantFk:foreignKey({name:"task_steps_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]}) }));

export const approvals = pgTable("approvals", {
  id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").references(()=>tasks.id), requestedByUserId:integer("requested_by_user_id").references(()=>users.id), reviewedByUserId:integer("reviewed_by_user_id").references(()=>users.id),
  actionDigest:text("action_digest").notNull(), requestId:text("request_id"), nonce:text("nonce").notNull().unique(), status:text("status",{enum:["pending","approved","denied","expired"]}).notNull().default("pending"),
  reason:text("reason"), expiresAt:ts("expires_at").notNull(), reviewedAt:ts("reviewed_at"), createdAt:ts("created_at").notNull().defaultNow(),
}, t => ({ tenantIdx:index("approvals_tenant_idx").on(t.tenantId), statusIdx:index("approvals_status_idx").on(t.status), nonceIdx:uniqueIndex("approvals_nonce_idx").on(t.nonce), digestIdx:index("approvals_digest_idx").on(t.actionDigest), taskTenantFk:foreignKey({name:"approvals_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]}), requesterTenantFk:foreignKey({name:"approvals_requester_same_tenant_fk",columns:[t.requestedByUserId,t.tenantId],foreignColumns:[users.id,users.tenantId]}), reviewerTenantFk:foreignKey({name:"approvals_reviewer_same_tenant_fk",columns:[t.reviewedByUserId,t.tenantId],foreignColumns:[users.id,users.tenantId]}) }));

export const nonces = pgTable("nonces", { id:serial("id").primaryKey(), kind:text("kind").notNull(), nonce:text("nonce").notNull(), taskId:integer("task_id"), createdAt:ts("created_at").notNull().defaultNow() }, t=>({uniqueNonce:uniqueIndex("nonces_unique_idx").on(t.kind,t.nonce)}));
export const interlocks = pgTable("interlocks", { id:serial("id").primaryKey(), killSwitch:boolean("kill_switch").notNull().default(false), circuitOpen:boolean("circuit_open").notNull().default(false), generation:integer("generation").notNull().default(0), reason:text("reason"), updatedByUserId:integer("updated_by_user_id"), updatedAt:ts("updated_at").notNull().defaultNow() });
export const budgetReservations = pgTable("budget_reservations", { id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").notNull().references(()=>tasks.id,{onDelete:"cascade"}), grantNonce:text("grant_nonce").notNull(), reservedTokens:integer("reserved_tokens").notNull(), reservedBytes:bigint("reserved_bytes",{mode:"number"}).notNull(), createdAt:ts("created_at").notNull().defaultNow() }, t=>({taskIdx:index("budget_res_task_idx").on(t.taskId),uniqueGrant:uniqueIndex("budget_res_grant_idx").on(t.taskId,t.grantNonce),tenantIdx:index("budget_res_tenant_idx").on(t.tenantId),taskTenantFk:foreignKey({name:"budget_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]})}));
export const auditLog = pgTable("audit_log", { id:serial("id").primaryKey(), eventType:text("event_type").notNull(), actorId:integer("actor_id"), tenantId:integer("tenant_id"), taskId:integer("task_id"), resourceType:text("resource_type"), resourceId:text("resource_id"), outcome:text("outcome",{enum:["success","failure","denied","error"]}), detail:jsonb("detail"), requestId:text("request_id"), ipAddress:text("ip_address"), createdAt:ts("created_at").notNull().defaultNow() }, t=>({tenantIdx:index("audit_log_tenant_id_idx").on(t.tenantId),eventTypeIdx:index("audit_log_event_type_idx").on(t.eventType),createdAtIdx:index("audit_log_created_at_idx").on(t.createdAt),actorIdx:index("audit_log_actor_idx").on(t.actorId)}));
export const capabilityLeases = pgTable("capability_leases", { id:serial("id").primaryKey(), leaseId:text("lease_id").notNull().unique(), taskId:integer("task_id").notNull(), tenantId:integer("tenant_id").notNull(), actorUserId:integer("actor_user_id").notNull(), capability:text("capability").notNull(), issuedAt:ts("issued_at").notNull(), expiresAt:ts("expires_at").notNull(), revokedAt:ts("revoked_at"), createdAt:ts("created_at").notNull().defaultNow() }, t=>({tenantIdx:index("capability_leases_tenant_idx").on(t.tenantId),taskTenantFk:foreignKey({name:"capability_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]}),actorTenantFk:foreignKey({name:"capability_actor_same_tenant_fk",columns:[t.actorUserId,t.tenantId],foreignColumns:[users.id,users.tenantId]})}));
export const artifacts = pgTable("artifacts", { id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").references(()=>tasks.id), stepId:integer("step_id").references(()=>taskSteps.id), storageKey:text("storage_key").notNull().unique(), filename:text("filename").notNull(), contentType:text("content_type").notNull(), size:bigint("size",{mode:"number"}).notNull(), sha256:text("sha256").notNull(), createdAt:ts("created_at").notNull().defaultNow() }, t=>({tenantIdx:index("artifacts_tenant_idx").on(t.tenantId),taskTenantFk:foreignKey({name:"artifacts_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]}),stepTenantFk:foreignKey({name:"artifacts_step_same_tenant_fk",columns:[t.stepId,t.tenantId],foreignColumns:[taskSteps.id,taskSteps.tenantId]})}));

export const evidenceRecords = pgTable("evidence_records", {
  id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").notNull(), evidenceId:text("evidence_id").notNull(),
  claimId:text("claim_id").notNull(), sourceId:text("source_id").notNull(), sourceFamily:text("source_family").notNull(), evidenceType:text("evidence_type").notNull(),
  statement:text("statement").notNull(), locator:text("locator").notNull(), retrievedAt:ts("retrieved_at").notNull(), contentDigest:text("content_digest").notNull(),
  derivedFrom:jsonb("derived_from").notNull().default([]), status:text("status").notNull().default("accepted"), createdAt:ts("created_at").notNull().defaultNow(),
}, t => ({taskIdx:index("evidence_task_idx").on(t.taskId),tenantIdx:index("evidence_tenant_idx").on(t.tenantId),evidenceUq:uniqueIndex("evidence_id_tenant_uq").on(t.evidenceId,t.tenantId),taskTenantFk:foreignKey({name:"evidence_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]})}));
export const governanceReviews = pgTable("governance_reviews", {
  id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").notNull(), stage:text("stage").notNull(), reviewerRole:text("reviewer_role").notNull(),
  status:text("status").notNull(), findings:jsonb("findings").notNull().default([]), evidenceRefs:jsonb("evidence_refs").notNull().default([]), createdAt:ts("created_at").notNull().defaultNow(),
}, t => ({taskIdx:index("governance_reviews_task_idx").on(t.taskId),tenantIdx:index("governance_reviews_tenant_idx").on(t.tenantId),taskTenantFk:foreignKey({name:"governance_reviews_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]})}));
export const governanceChallenges = pgTable("governance_challenges", {
  id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").notNull(), actorRole:text("actor_role").notNull(), category:text("category").notNull(),
  status:text("status").notNull(), detail:jsonb("detail").notNull().default({}), createdAt:ts("created_at").notNull().defaultNow(),
}, t => ({taskIdx:index("governance_challenges_task_idx").on(t.taskId),tenantIdx:index("governance_challenges_tenant_idx").on(t.tenantId),taskTenantFk:foreignKey({name:"governance_challenges_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]})}));
export const governanceDecisions = pgTable("governance_decisions", {
  id:serial("id").primaryKey(), tenantId:integer("tenant_id").notNull(), taskId:integer("task_id").notNull(), status:text("status").notNull(), findings:jsonb("findings").notNull().default([]),
  evidenceRefs:jsonb("evidence_refs").notNull().default([]), justiceReview:jsonb("justice_review").notNull().default({}), uncertainties:jsonb("uncertainties").notNull().default([]),
  corrections:jsonb("corrections").notNull().default([]), auditId:text("audit_id").notNull(), createdAt:ts("created_at").notNull().defaultNow(),
}, t => ({taskIdx:index("governance_decisions_task_idx").on(t.taskId),tenantIdx:index("governance_decisions_tenant_idx").on(t.tenantId),taskTenantFk:foreignKey({name:"governance_decisions_task_same_tenant_fk",columns:[t.taskId,t.tenantId],foreignColumns:[tasks.id,tasks.tenantId]})}));

export const schema={tenants,users,sessions,tasks,taskSteps,approvals,nonces,interlocks,budgetReservations,auditLog,capabilityLeases,artifacts,evidenceRecords,governanceReviews,governanceChallenges,governanceDecisions};