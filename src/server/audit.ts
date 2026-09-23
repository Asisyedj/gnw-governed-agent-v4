import type { Db } from "./db/index.js";
import { insertAuditLog } from "./repo.js";

export type AuditEventType =
  | "auth.signin" | "auth.signout" | "auth.failed"
  | "task.create" | "task.approve" | "task.deny" | "task.stop" | "task.complete" | "task.fail"
  | "grant.issue" | "grant.deny" | "grant.expire" | "grant.replay"
  | "approval.create" | "approval.use" | "approval.expire" | "approval.replay"
  | "capability.lease" | "capability.consume" | "capability.expire"
  | "governance.pass" | "governance.fail" | "governance.deny"
  | "kill_switch.engage" | "kill_switch.release"
  | "secret.rotate" | "backup.create" | "backup.verify"
  | "tool.invoke" | "tool.deny"
  | "video.create" | "video.approve" | "video.deny" | "video.stop"
  | "workspace.create" | "workspace.update"
  | "user.create" | "user.update" | "user.role_change"
  | "admin.action"
  | "council.decision" | "council.override"
  | "system.startup" | "system.readiness";

export interface AuditEvent {
  eventType: AuditEventType;
  actorId?: number | null;
  tenantId?: number | null;
  taskId?: number | null;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: "success" | "failure" | "deny";
  detail?: Record<string, unknown> | null;
  requestId?: string | null;
  ipAddress?: string | null;
}

export async function audit(db: Db, event: AuditEvent): Promise<void> {
  try {
    await insertAuditLog(db, {
      eventType: event.eventType,
      actorId: event.actorId ?? null,
      tenantId: event.tenantId ?? null,
      taskId: event.taskId ?? null,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      outcome: event.outcome,
      detail: event.detail ? JSON.stringify(event.detail) : null,
      requestId: event.requestId ?? null,
      ipAddress: event.ipAddress ?? null,
    });
  } catch (err) {
    // Audit must never crash the caller
    console.error("[audit] failed to write audit log:", err);
  }
}

export function getRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header) return header.slice(0, 64);
  return "";
}

export function getIpAddress(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "";
  return req.ip ?? "";
}
