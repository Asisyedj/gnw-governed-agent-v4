// GNW Adaptive Immune Defense - Attack/Anomaly Classifier
// Behavior + Authorization + Provenance + Evidence determine trust.

import type { AttackClass, TrustSignal } from "./types.ts";

export interface ClassificationInput {
  behavior_signals: TrustSignal[];
  authorization_valid: boolean;
  provenance_verified: boolean;
  evidence_quality: "high" | "medium" | "low" | "none";
  task_scope_matched: boolean;
  risk_level: "low" | "medium" | "high";
  description: string;
}

const suspiciousPatterns: Array<{ signals: TrustSignal[]; attack_class: AttackClass }> = [
  {
    signals: ["authorization_invalid", "behavior_inconsistent"],
    attack_class: "authorization_anomaly",
  },
  {
    signals: ["task_scope_exceeded", "authorization_valid"],
    attack_class: "scope_violation",
  },
  {
    signals: ["evidence_low_quality", "provenance_unknown"],
    attack_class: "evidence_manipulation",
  },
  {
    signals: ["current_risk_high", "behavior_inconsistent"],
    attack_class: "social_engineering_deception",
  },
  {
    signals: ["independent_verification_fail"],
    attack_class: "proof_forgery",
  },
  {
    signals: ["historical_verified_behavior", "behavior_inconsistent", "task_scope_exceeded"],
    attack_class: "trusted_insider_like_behavior",
  },
];

export function classifyAnomaly(input: ClassificationInput): { attack_class: AttackClass; confidence: number; reason: string } {
  const { behavior_signals, authorization_valid, provenance_verified, evidence_quality, task_scope_matched, risk_level, description } = input;

  // Unknown behavior must not be considered safe
  if (evidence_quality === "none" || behavior_signals.length === 0) {
    return {
      attack_class: "unknown_anomaly",
      confidence: 2,
      reason: "Insufficient signals; failing closed",
    };
  }

  // Check for known suspicious patterns
  for (const pattern of suspiciousPatterns) {
    const hasAllSignals = pattern.signals.every((s) => behavior_signals.includes(s));
    if (hasAllSignals) {
      return {
        attack_class: pattern.attack_class,
        confidence: 4,
        reason: `Matched pattern: ${pattern.attack_class}`,
      };
    }
  }

  // Fallback heuristics
  if (!authorization_valid) {
    return {
      attack_class: "authentication_anomaly",
      confidence: 3,
      reason: "Authorization invalid",
    };
  }

  if (!task_scope_matched) {
    return {
      attack_class: "scope_violation",
      confidence: 3,
      reason: "Task scope exceeded",
    };
  }

  if (evidence_quality === "low" && !provenance_verified) {
    return {
      attack_class: "evidence_manipulation",
      confidence: 3,
      reason: "Low evidence quality with unverified provenance",
    };
  }

  if (risk_level === "high" && behavior_signals.includes("behavior_inconsistent")) {
    return {
      attack_class: "social_engineering_deception",
      confidence: 3,
      reason: "High risk with inconsistent behavior",
    };
  }

  // Default: unknown anomaly, but mark as pending investigation
  return {
    attack_class: "unknown_anomaly",
    confidence: 1,
    reason: "No strong pattern matched; requires investigation",
  };
}
