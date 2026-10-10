import { describe, it, expect } from "vitest";
import { classifyAnomaly } from "../../server/immune/classifier.js";

describe("Adaptive Immune Defense - Classifier", () => {
  it("blocks unknown anomaly with no evidence (fail closed)", () => {
    const result = classifyAnomaly({
      behavior_signals: [],
      authorization_valid: false,
      provenance_verified: false,
      evidence_quality: "none",
      task_scope_matched: false,
      risk_level: "medium",
      description: "Empty signals",
    });
    expect(result.attack_class).toBe("unknown_anomaly");
    expect(result.confidence).toBeGreaterThanOrEqual(1);
  });

  it("detects scope violation when task scope exceeded", () => {
    const result = classifyAnomaly({
      behavior_signals: ["task_scope_exceeded", "authorization_valid"],
      authorization_valid: true,
      provenance_verified: true,
      evidence_quality: "high",
      task_scope_matched: false,
      risk_level: "medium",
      description: "Scope exceeded",
    });
    expect(result.attack_class).toBe("scope_violation");
  });

  it("detects trusted-insider-like behavior pattern", () => {
    const result = classifyAnomaly({
      behavior_signals: [
        "historical_verified_behavior",
        "behavior_inconsistent",
        "task_scope_exceeded",
      ],
      authorization_valid: true,
      provenance_verified: true,
      evidence_quality: "high",
      task_scope_matched: false,
      risk_level: "medium",
      description: "Trusted component behaving inconsistently",
    });
    expect(result.attack_class).toBe("trusted_insider_like_behavior");
  });

  it("flags social engineering deception on high risk + inconsistent behavior", () => {
    const result = classifyAnomaly({
      behavior_signals: ["current_risk_high", "behavior_inconsistent"],
      authorization_valid: true,
      provenance_verified: false,
      evidence_quality: "medium",
      task_scope_matched: true,
      risk_level: "high",
      description: "Friendly but risky requester",
    });
    expect(result.attack_class).toBe("social_engineering_deception");
  });
});
