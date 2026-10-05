// GNW Adaptive Immune Defense - Learning Without Self-Corruption
// RAW OBSERVATION → SANITIZATION → INDEPENDENT ANALYSIS → VERIFICATION → DEFENSIVE KNOWLEDGE → REGRESSION TEST → APPROVAL → ACTIVE RULE

import type { ThreatMemory, DefensiveRule } from "./types.ts";
import { getVerifiedThreats } from "./memory.ts";

export function proposeDefensiveRule(fromMemories: ThreatMemory[], description: string): DefensiveRule {
  // Defense monotonicity: rules must not reduce security posture
  const enforces: DefensiveRule["enforces"] = ["detection", "verification"];
  if (fromMemories.some((m) => m.attack_class.includes("evidence"))) {
    enforces.push("evidence");
  }
  if (fromMemories.some((m) => m.attack_class.includes("escalation") || m.attack_class.includes("scope"))) {
    enforces.push("isolation");
  }

  const rule: DefensiveRule = {
    rule_id: `rule:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
    derived_from_memory_ids: fromMemories.map((m) => m.memory_id),
    description,
    enforces,
    security_posture_impact: "increase",
    requires_approval: true,
    approved_by: null,
    approved_at: null,
    active: false,
  };

  return rule;
}

export function approveRule(rule: DefensiveRule, approver: string): DefensiveRule {
  if (!rule.requires_approval) {
    throw new Error("Rule does not require approval");
  }
  rule.approved_by = approver;
  rule.approved_at = new Date().toISOString();
  rule.active = true;
  return rule;
}

export function generateRegressionTestFromThreat(threat: ThreatMemory): string {
  // Generate a defensive regression test ID (actual test code will be in src/tests/immune/)
  return `test:immune:${threat.attack_class}:${threat.memory_id}`;
}

export function getDefensiveLearningSummary(): { verified_threats: number; active_rules: number } {
  const verified = getVerifiedThreats();
  return {
    verified_threats: verified.length,
    active_rules: 0, // Will be wired to a rule store later
  };
}
