export const GOVERNANCE_ROLES = [
  "human_principal","central_governor","research_worker","evidence_auditor",
  "specialist_worker","red_team","bias_auditor","justice_reviewer","final_arbiter"
] as const;
export type GovernanceRole = typeof GOVERNANCE_ROLES[number];

export const CAPABILITIES = [
  "read","route","append_evidence","provenance","analyze","challenge","review",
  "final_decision","permission_control","external_side_effect"
] as const;
export type Capability = typeof CAPABILITIES[number];

export const ROLE_CAPABILITIES: Record<GovernanceRole, readonly Capability[]> = {
  human_principal: CAPABILITIES,
  central_governor: ["read","route"],
  research_worker: ["read","append_evidence"],
  evidence_auditor: ["read","append_evidence","provenance"],
  specialist_worker: ["read","analyze"],
  red_team: ["read","challenge"],
  bias_auditor: ["read","challenge"],
  justice_reviewer: ["read","review"],
  final_arbiter: ["read","final_decision"],
};

export const GOVERNANCE_PIPELINE: readonly GovernanceRole[] = [
  "human_principal","central_governor","research_worker","evidence_auditor",
  "specialist_worker","red_team","bias_auditor","justice_reviewer","final_arbiter"
];

export function isCapabilityAllowed(role: GovernanceRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function assertCapability(role: GovernanceRole, capability: Capability): void {
  if (!isCapabilityAllowed(role, capability)) throw new Error("permission_denied:" + role + ":" + capability);
}

export function canMakeFinalDecision(role: GovernanceRole): boolean {
  return role === "final_arbiter" || role === "human_principal";
}