import { randomBytes } from "node:crypto";

export function generateNonce(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export type CapabilityLease = {
  leaseId: string;
  taskId: string;
  tenantId: string;
  actorId: string;
  tool: string;
  operation: string;
  scope: string;
  expiresAt: number;
  consumed: boolean;
};

export function makeCapabilityLease(
  taskId: string,
  tenantId: string,
  actorId: string,
  tool: string,
  operation: string,
  scope: string,
  ttlMs: number
): CapabilityLease {
  return {
    leaseId: generateNonce(24),
    taskId, tenantId, actorId, tool, operation, scope,
    expiresAt: Date.now() + ttlMs,
    consumed: false,
  };
}

export function isLeaseValid(lease: CapabilityLease, nowMs = Date.now()): boolean {
  return !lease.consumed && lease.expiresAt > nowMs;
}
