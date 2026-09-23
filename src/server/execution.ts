import { randomUUID } from "node:crypto";
import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { audit } from "./audit.js";
import { governedFetch, assertEgressUrl } from "./security.js";
import { callExecutor } from "./executor-client.js";
import { validateEnvelope, digestEnvelope, type ActionEnvelope } from "./action-envelope.js";

export type ExecutionContext = {
  db: Db;
  env: Env;
  taskId: number;
  tenantId: number;
  actorId: number;
  requestId: string;
};

export type ExecutionResult = {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
};

export async function executeWithGovernance(
  ctx: ExecutionContext,
  envelope: ActionEnvelope,
  handler: () => Promise<unknown>
): Promise<ExecutionResult> {
  const start = Date.now();
  try {
    validateEnvelope(envelope);
    const digest = digestEnvelope(envelope);
    await audit(ctx.db, {
      eventType: "tool.invoke",
      actorId: ctx.actorId,
      tenantId: ctx.tenantId,
      taskId: ctx.taskId,
      resourceType: "tool",
      resourceId: envelope.tool,
      outcome: "success",
      detail: { digest, operation: envelope.operation, scope: envelope.tool },
      requestId: ctx.requestId,
    });
    const output = await handler();
    return { success: true, output, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit(ctx.db, {
      eventType: "tool.deny",
      actorId: ctx.actorId,
      tenantId: ctx.tenantId,
      taskId: ctx.taskId,
      resourceType: "tool",
      resourceId: envelope.tool,
      outcome: "failure",
      detail: { error: message },
      requestId: ctx.requestId,
    });
    return { success: false, error: message, durationMs: Date.now() - start };
  }
}

export async function safeEgressFetch(
  url: string,
  init: RequestInit,
  allowedHosts: readonly string[],
  maxBytes: number
): Promise<Response> {
  assertEgressUrl(url, allowedHosts);
  return governedFetch(url, init, maxBytes);
}
