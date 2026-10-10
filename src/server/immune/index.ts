// GNW Adaptive Immune Defense - Public API
// BUILD DEFENSE, NOT OFFENSE. VERIFY EVERYTHING. FAIL CLOSED.

import { classifyAnomaly, type ClassificationInput } from "./classifier.js";

export type {
  AttackClass,
  SecurityState,
  TrustSignal,
  ThreatMemory,
  DefensiveRule,
  ImmuneState,
} from "./types.js";

export { classifyAnomaly, type ClassificationInput } from "./classifier.js";
export { executeContainment, type ContainmentResult } from "./containment.js";
export {
  createThreatMemory,
  getVerifiedThreats,
  getThreatByClass,
  markMemoryResolved,
} from "./memory.js";
export {
  proposeDefensiveRule,
  approveRule,
  generateRegressionTestFromThreat,
  getDefensiveLearningSummary,
} from "./learning.js";

// Integration hook: call this from security.ts pre-checks
export function immunePreCheck(input: ClassificationInput): { allowed: boolean; reason: string; state: "NORMAL" | "SUSPICIOUS" | "CONTAINED" } {
  const classification = classifyAnomaly(input);

  if (classification.confidence >= 4) {
    return {
      allowed: false,
      reason: `High-confidence ${classification.attack_class}: ${classification.reason}`,
      state: "SUSPICIOUS",
    };
  }

  if (classification.attack_class === "unknown_anomaly" && input.evidence_quality === "none") {
    return {
      allowed: false,
      reason: "Unknown anomaly with no evidence; failing closed",
      state: "SUSPICIOUS",
    };
  }

  return {
    allowed: true,
    reason: classification.reason,
    state: "NORMAL",
  };
}
