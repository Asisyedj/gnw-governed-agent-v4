import type { Db } from "./db/index.js";
import type { Env } from "./env.js";

export type PilotConfig = {
  id: string;
  label: string;
  enabled: boolean;
  rolloutPct: number;
  description: string;
};

const PILOTS: PilotConfig[] = [
  { id: "council_shadow", label: "Council Shadow Mode", enabled: false, rolloutPct: 0, description: "Run council evaluation in shadow mode without blocking" },
  { id: "deep_research_v2", label: "Deep Research v2", enabled: true, rolloutPct: 100, description: "Use o3-deep-research model for extended research tasks" },
  { id: "speculative_execution", label: "Speculative Execution", enabled: false, rolloutPct: 0, description: "Pre-execute likely next steps in parallel" },
  { id: "merkle_chain_v2", label: "Merkle Chain v2", enabled: true, rolloutPct: 100, description: "Enhanced trajectory integrity with Merkle chaining" },
];

export function listPilots(): PilotConfig[] {
  return PILOTS.map(p => ({ ...p }));
}

export function isPilotEnabled(id: string, tenantId?: number): boolean {
  const pilot = PILOTS.find(p => p.id === id);
  if (!pilot || !pilot.enabled) return false;
  if (pilot.rolloutPct >= 100) return true;
  if (pilot.rolloutPct <= 0) return false;
  if (tenantId !== undefined) {
    return (tenantId % 100) < pilot.rolloutPct;
  }
  return Math.random() * 100 < pilot.rolloutPct;
}
