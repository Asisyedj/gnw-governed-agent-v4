import { sha256, canonicalize } from "./security.js";
import { verifyChain, chainEntry, type TrajectoryEntry } from "./merkle.js";

export type InvariantViolation = { code: string; detail?: unknown };

export function assertNoViolations(violations: InvariantViolation[]): void {
  if (violations.length > 0) {
    const codes = violations.map(v => v.code).join(", ");
    throw new Error(`Invariant violations: ${codes}`);
  }
}

export function checkTaskInvariants(task: {
  id: number; status: string; tenantId: number; createdByUserId: number;
  budgetTokensUsed: number; budgetBytesUsed: number;
  trajectoryRootHash: string | null; trajectorySteps: number;
}): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  if (!task.id || !Number.isInteger(task.id) || task.id <= 0) v.push({ code: "task_id_invalid" });
  if (!task.tenantId || !Number.isInteger(task.tenantId)) v.push({ code: "task_tenant_missing" });
  if (!task.createdByUserId || !Number.isInteger(task.createdByUserId)) v.push({ code: "task_creator_missing" });
  if (task.budgetTokensUsed < 0) v.push({ code: "budget_tokens_negative" });
  if (task.budgetBytesUsed < 0) v.push({ code: "budget_bytes_negative" });
  if (task.trajectorySteps > 0 && !task.trajectoryRootHash) v.push({ code: "trajectory_root_missing" });
  const validStatuses = ["pending", "running", "waiting_approval", "done", "failed", "cancelled"];
  if (!validStatuses.includes(task.status)) v.push({ code: "task_status_invalid", detail: task.status });
  return v;
}

export function checkStepInvariants(step: {
  id: number; taskId: number; stepIndex: number;
  agentRole: string; toolName: string;
  inputDigest: string; outputDigest: string | null;
  chainHash: string; prevChainHash: string | null;
}): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  if (!step.id || !Number.isInteger(step.id)) v.push({ code: "step_id_invalid" });
  if (!step.taskId || !Number.isInteger(step.taskId)) v.push({ code: "step_task_missing" });
  if (!Number.isInteger(step.stepIndex) || step.stepIndex < 0) v.push({ code: "step_index_invalid" });
  if (!step.agentRole || typeof step.agentRole !== "string") v.push({ code: "step_agent_missing" });
  if (!step.toolName || typeof step.toolName !== "string") v.push({ code: "step_tool_missing" });
  if (!step.inputDigest || !/^[0-9a-f]{64}$/.test(step.inputDigest)) v.push({ code: "step_input_digest_invalid" });
  if (!step.chainHash || !/^[0-9a-f]{64}$/.test(step.chainHash)) v.push({ code: "step_chain_hash_invalid" });
  return v;
}

export function buildTrajectoryChain(steps: Array<{ stepIndex: number; inputDigest: string; outputDigest: string | null }>): TrajectoryEntry[] {
  const sorted = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const chain: TrajectoryEntry[] = [];
  for (const step of sorted) {
    const digest = sha256(`${step.stepIndex}:${step.inputDigest}:${step.outputDigest ?? "null"}`);
    const prev = chain.length > 0 ? chain[chain.length - 1]! : null;
    chain.push(chainEntry(step.stepIndex, digest, prev));
  }
  return chain;
}

export function verifyTrajectoryIntegrity(steps: Array<{ stepIndex: number; inputDigest: string; outputDigest: string | null; chainHash: string; prevChainHash: string | null }>): boolean {
  const chain = buildTrajectoryChain(steps);
  return verifyChain(chain);
}

export function computeTrajectoryRoot(steps: Array<{ stepIndex: number; inputDigest: string; outputDigest: string | null }>): string {
  if (steps.length === 0) return sha256("empty-trajectory");
  const chain = buildTrajectoryChain(steps);
  return chain[chain.length - 1]!.chainHash;
}

export function digestToolInput(tool: string, operation: string, params: Record<string, unknown>): string {
  return sha256(`tool-input:${tool}:${operation}:${canonicalize(params)}`);
}

export function digestToolOutput(tool: string, operation: string, result: unknown): string {
  return sha256(`tool-output:${tool}:${operation}:${canonicalize(result)}`);
}
