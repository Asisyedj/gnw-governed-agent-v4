import { createHash } from "node:crypto";
import type { ActionEnvelope } from "../action-envelope.js";
import type { GovernanceRequest } from "../governance.js";

export const GOVERNED_EXECUTION_JOB = "governed_tool_execution";

export type QueuedExecutionPayload = {
  version: 1;
  taskId: number;
  tenantId: number;
  actorId: number;
  role: string;
  requestId: string;
  grant: GovernanceRequest;
  envelope: ActionEnvelope;
  approvalId?: number;
};

/** Stable JSON for integrity digests; matches JSON serialization for valid JSON values. */
export function canonicalQueueJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_JSON_QUEUE_PAYLOAD");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(item => item === undefined ? "null" : canonicalQueueJson(item)).join(",") + "]";
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const members = Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ":" + canonicalQueueJson(object[key]));
    return "{" + members.join(",") + "}";
  }
  throw new Error("NON_JSON_QUEUE_PAYLOAD");
}

export function digestQueuePayload(payload: unknown): string {
  return createHash("sha256").update(canonicalQueueJson(payload), "utf8").digest("hex");
}

export function parseQueuedExecutionPayload(value: unknown): QueuedExecutionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("QUEUE_PAYLOAD_INVALID");
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1 ||
      !Number.isSafeInteger(payload.taskId) || Number(payload.taskId) <= 0 ||
      !Number.isSafeInteger(payload.tenantId) || Number(payload.tenantId) <= 0 ||
      !Number.isSafeInteger(payload.actorId) || Number(payload.actorId) <= 0 ||
      typeof payload.role !== "string" || !payload.role.trim() ||
      typeof payload.requestId !== "string" || !payload.requestId.trim() ||
      !payload.grant || typeof payload.grant !== "object" || Array.isArray(payload.grant) ||
      !payload.envelope || typeof payload.envelope !== "object" || Array.isArray(payload.envelope) ||
      (payload.approvalId !== undefined && (!Number.isSafeInteger(payload.approvalId) || Number(payload.approvalId) <= 0))) {
    throw new Error("QUEUE_PAYLOAD_INVALID");
  }
  return value as QueuedExecutionPayload;
}
