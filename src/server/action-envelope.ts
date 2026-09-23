import { createHash } from "node:crypto";

export type ActionEnvelope = {
  taskId: string;
  tenantId: string;
  actorId: string;
  operation: string;
  tool: string;
  parameters: unknown;
  grantId: string;
  nonce: string;
  issuedAt: number;
};

export function digestEnvelope(env: ActionEnvelope): string {
  const canonical = JSON.stringify([
    env.taskId, env.tenantId, env.actorId,
    env.operation, env.tool, env.parameters,
    env.grantId, env.nonce, env.issuedAt
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateEnvelope(env: ActionEnvelope, nowMs = Date.now(), maxAgeMs = 300_000): void {
  if (!env.taskId || !env.tenantId || !env.actorId || !env.operation || !env.tool || !env.grantId || !env.nonce) {
    throw new Error("ActionEnvelope: missing required field");
  }
  const age = nowMs - env.issuedAt;
  if (age < 0 || age > maxAgeMs) {
    throw new Error(`ActionEnvelope: issuedAt is outside valid window (age=${age}ms)`);
  }
}
