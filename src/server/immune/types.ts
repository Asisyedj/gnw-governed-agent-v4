// GNW Adaptive Immune Defense - Core Types
// Every verified attack becomes a verified defensive improvement.

export type AttackClass =
  | "authentication_anomaly"
  | "authorization_anomaly"
  | "privilege_escalation_attempt"
  | "prompt_injection"
  | "tool_misuse"
  | "scope_violation"
  | "data_exfiltration_attempt"
  | "evidence_manipulation"
  | "ledger_tampering"
  | "proof_forgery"
  | "verifier_manipulation"
  | "dependency_poisoning"
  | "configuration_manipulation"
  | "persistence_attempt"
  | "replay_attempt"
  | "identity_spoofing"
  | "trusted_insider_like_behavior"
  | "social_engineering_deception"
  | "resource_exhaustion"
  | "unknown_anomaly";

export type SecurityState =
  | "NORMAL"
  | "SUSPICIOUS"
  | "CONTAINED"
  | "INVESTIGATING"
  | "VERIFIED_THREAT"
  | "HARDENING"
  | "REVALIDATING"
  | "RECOVERED"
  | "MONITORING";

export type TrustSignal =
  | "authorization_valid"
  | "authorization_invalid"
  | "provenance_verified"
  | "provenance_unknown"
  | "evidence_high_quality"
  | "evidence_low_quality"
  | "behavior_consistent"
  | "behavior_inconsistent"
  | "task_scope_matched"
  | "task_scope_exceeded"
  | "historical_verified_behavior"
  | "historical_unverified_behavior"
  | "current_risk_low"
  | "current_risk_high"
  | "independent_verification_pass"
  | "independent_verification_fail";

export interface ThreatMemory {
  memory_id: string;
  attack_class: AttackClass;
  observed_pattern: string;
  affected_component: string;
  evidence_ids: string[];
  root_cause: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: 0 | 1 | 2 | 3 | 4 | 5; // 0=speculative, 5=verified
  detection_rule: string;
  containment_action: string;
  recovery_action: string;
  regression_test_id: string | null;
  created_at: string; // ISO 8601
  source_proof: string; // Merkle root or audit log ID
  status: "pending" | "verified" | "unresolved" | "rejected";
}

export interface DefensiveRule {
  rule_id: string;
  derived_from_memory_ids: string[];
  description: string;
  enforces: Array<"detection" | "verification" | "containment" | "evidence" | "isolation">;
  security_posture_impact: "increase" | "neutral" | "decrease";
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  active: boolean;
}

export interface ImmuneState {
  current_state: SecurityState;
  state_transitions: Array<{ from: SecurityState; to: SecurityState; reason: string; at: string }>;
  active_threats: string[]; // memory_ids
  hardened_rules: string[]; // rule_ids
  last_verified_at: string | null;
}
