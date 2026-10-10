// GNW Adaptive Immune Defense - Immune Memory
// Only verified evidence may create durable defensive memory.

import type { ThreatMemory, AttackClass } from "./types";

let memoryStore: ThreatMemory[] = [];

export function createThreatMemory(
  attack_class: AttackClass,
  observed_pattern: string,
  affected_component: string,
  evidence_ids: string[],
  root_cause: string,
  severity: ThreatMemory["severity"],
  confidence: ThreatMemory["confidence"],
  detection_rule: string,
  containment_action: string,
  recovery_action: string,
  source_proof: string
): ThreatMemory {
  const memory: ThreatMemory = {
    memory_id: `threat:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    attack_class,
    observed_pattern,
    affected_component,
    evidence_ids,
    root_cause,
    severity,
    confidence,
    detection_rule,
    containment_action,
    recovery_action,
    regression_test_id: null,
    created_at: new Date().toISOString(),
    source_proof,
    status: confidence >= 4 ? "verified" : "pending",
  };

  memoryStore.push(memory);
  return memory;
}

export function getVerifiedThreats(): ThreatMemory[] {
  return memoryStore.filter((m) => m.status === "verified");
}

export function getThreatByClass(attack_class: AttackClass): ThreatMemory[] {
  return memoryStore.filter((m) => m.attack_class === attack_class);
}

export function markMemoryResolved(memory_id: string, status: "verified" | "rejected" | "unresolved"): void {
  const idx = memoryStore.findIndex((m) => m.memory_id === memory_id);
  if (idx === -1) throw new Error(`Threat memory ${memory_id} not found`);
  const memory = memoryStore[idx];
  if (!memory) throw new Error(`Threat memory ${memory_id} not found`);
  memory.status = status;
}
