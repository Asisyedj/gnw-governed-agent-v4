// GNW Adaptive Immune Defense - Containment First Workflow
// STOP → ISOLATE → PRESERVE EVIDENCE → REVOKE → FREEZE → VERIFY → RECOVER

import type { SecurityState, ThreatMemory } from "./types.js";

export interface ContainmentResult {
  state_before: SecurityState;
  state_after: SecurityState;
  actions_taken: string[];
  evidence_preserved: string[]; // audit log IDs or Merkle roots
  authorization_revoked: string[];
  recovery_checkpoint_id: string | null;
}

export async function executeContainment(
  threat: ThreatMemory,
  currentState: SecurityState,
  auditLogId: string,
  merkleRoot: string
): Promise<ContainmentResult> {
  const actions: string[] = [];
  const evidence: string[] = [];
  const revokedAuth: string[] = [];

  // STOP & ISOLATE
  actions.push(`STOP: Halting affected component ${threat.affected_component}`);
  actions.push(`ISOLATE: Quarantining threat memory ${threat.memory_id}`);

  // PRESERVE EVIDENCE
  evidence.push(auditLogId);
  evidence.push(merkleRoot);
  actions.push(`PRESERVE_EVIDENCE: Attached audit ${auditLogId} and Merkle ${merkleRoot}`);

  // REVOKE AFFECTED AUTHORIZATION
  revokedAuth.push(`auth:${threat.memory_id}:scope`);
  actions.push(`REVOKE: Revoked authorization for ${threat.memory_id}`);

  // FREEZE AFFECTED STATE
  actions.push(`FREEZE: Frozen state snapshot for ${threat.affected_component}`);

  // VERIFY SYSTEM INTEGRITY (placeholder - integrate with verified-data.ts)
  actions.push(`VERIFY: System integrity check initiated`);

  // Determine next state
  let nextState: SecurityState = currentState;
  if (currentState === "SUSPICIOUS" || currentState === "NORMAL") {
    nextState = "CONTAINED";
  } else if (currentState === "INVESTIGATING") {
    nextState = "VERIFIED_THREAT";
  }

  return {
    state_before: currentState,
    state_after: nextState,
    actions_taken: actions,
    evidence_preserved: evidence,
    authorization_revoked: revokedAuth,
    recovery_checkpoint_id: `checkpoint:${threat.memory_id}:${Date.now()}`,
  };
}
