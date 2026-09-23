import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { governedFetch } from "./security.js";

export type NotifyEvent = {
  kind: "task.created" | "task.done" | "task.failed" | "approval.required" | "kill_switch.triggered" | "custom";
  taskId?: number; tenantId?: number; userId?: number;
  title: string; body: string;
  data?: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function notify(env: Env, event: NotifyEvent): Promise<void> {
  if (!env.notifyWebhookUrl) return;
  try {
    await governedFetch(env.notifyWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GNW-Event": event.kind, ...(event.idempotencyKey ? { "Idempotency-Key": event.idempotencyKey } : {}) },
      body: JSON.stringify(event),
    }, 1024 * 1024);
  } catch (err) {
    console.error("[notify] webhook delivery failed:", err instanceof Error ? err.message : String(err));
  }
}
