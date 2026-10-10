/**
 * Unit tests for GNW Immutable Progress Ledger
 *
 * Covers:
 * - Valid causal event sequence
 * - Duplicate event_id rejection
 * - Missing causal parent rejection
 * - Self-causal event rejection
 * - Tampered payload/hash integrity failure
 * - Immutable snapshots (no mutation after append)
 * - Deterministic replay (same events → same state)
 * - Verification without verification event rejection
 * - Mission completion without satisfied DoD rejection
 * - Events after terminal mission state rejection
 * - Restart from exported event stream (same reconstructed state)
 * - Out-of-order causal event rejection
 */

import { describe, it, expect } from "vitest";
import {
  Ledger,
  InvalidLedgerEventError,
  LedgerIntegrityError,
  testDependencies,
  type LedgerEvent,
} from "../../executor/ledger";

const deps = testDependencies();

describe("Ledger", () => {
  it("accepts a valid causal event sequence", async () => {
    const ledger = new Ledger(deps);

    const evt1 = await ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_CREATED",
      mission_id: "MISSION-001",
      caused_by: [],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: null,
    });

    const evt2 = await ledger.append({
      event_id: "EVT-001",
      event_type: "MISSION_PLANNED",
      mission_id: "MISSION-001",
      caused_by: ["EVT-000"],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: evt1.event_hash,
    });

    expect(evt1.event_id).toBe("EVT-000");
    expect(evt2.event_id).toBe("EVT-001");
    expect(evt2.caused_by).toEqual(["EVT-000"]);
  });

  it("rejects duplicate event_id", async () => {
    const ledger = new Ledger(deps);

    await ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_CREATED",
      mission_id: "MISSION-001",
      caused_by: [],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: null,
    });

    await expect(
      ledger.append({
        event_id: "EVT-000",
        event_type: "MISSION_PLANNED",
        mission_id: "MISSION-001",
        caused_by: ["EVT-000"],
        timestamp: deps.nowIso(),
        payload: {},
        previous_hash: null,
      })
    ).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects missing causal parent", async () => {
    const ledger = new Ledger(deps);

    await expect(
      ledger.append({
        event_id: "EVT-000",
        event_type: "MISSION_PLANNED",
        mission_id: "MISSION-001",
        caused_by: ["EVT-MISSING"],
        timestamp: deps.nowIso(),
        payload: {},
        previous_hash: null,
      })
    ).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects self-causal event", async () => {
    const ledger = new Ledger(deps);

    await expect(
      ledger.append({
        event_id: "EVT-000",
        event_type: "MISSION_CREATED",
        mission_id: "MISSION-001",
        caused_by: ["EVT-000"],
        timestamp: deps.nowIso(),
        payload: {},
        previous_hash: null,
      })
    ).rejects.toThrow(InvalidLedgerEventError);
  });

  it("detects tampered payload/hash integrity failure", async () => {
    const ledger = new Ledger(deps);

    const evt1 = await ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_CREATED",
      mission_id: "MISSION-001",
      caused_by: [],
      timestamp: deps.nowIso(),
      payload: { original: true },
      previous_hash: null,
    });

    // Attempt to append with wrong hash
    await expect(
      ledger.append({
        event_id: "EVT-001",
        event_type: "MISSION_PLANNED",
        mission_id: "MISSION-001",
        caused_by: ["EVT-000"],
        timestamp: deps.nowIso(),
        payload: {},
        previous_hash: "tampered-hash",
      })
    ).rejects.toThrow(LedgerIntegrityError);
  });

  it("does not mutate historical events after append", async () => {
    const ledger = new Ledger(deps);

    const evt1 = await ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_CREATED",
      mission_id: "MISSION-001",
      caused_by: [],
      timestamp: deps.nowIso(),
      payload: { immutable: true },
      previous_hash: null,
    });

    const snapshot = ledger.getAllEvents();
    const snapshotHash = evt1.event_hash;

    // Attempt to mutate (should have no effect on ledger internals)
    (snapshot[0] as any).payload.mutated = true;

    const retrieved = ledger.getEvent("EVT-000");
    expect(retrieved?.payload).toEqual({ immutable: true });
    expect(retrieved?.event_hash).toBe(snapshotHash);
  });

  it("replays same events twice to identical state", async () => {
    const source = new Ledger(deps);
    const first = await source.append({
      event_id: "EVT-000", event_type: "MISSION_CREATED", mission_id: "MISSION-001",
      caused_by: [], timestamp: "2026-10-05T00:00:00.000Z", payload: {}, previous_hash: null,
    });
    await source.append({
      event_id: "EVT-001", event_type: "MISSION_PLANNED", mission_id: "MISSION-001",
      caused_by: ["EVT-000"], timestamp: "2026-10-05T00:00:01.000Z", payload: {}, previous_hash: first.event_hash,
    });
    const events = source.export();
    const ledger1 = await Ledger.replay(events, deps);
    const ledger2 = await Ledger.replay(events, deps);
    const state1 = ledger1.reconstructState();
    const state2 = ledger2.reconstructState();
    expect(state1.mission_status).toBe(state2.mission_status);
    expect(state1.tasks).toEqual(state2.tasks);
    expect(state1.dod).toEqual(state2.dod);
  });

  it("rejects TASK_VERIFIED without prior VERIFICATION_COMPLETED", async () => {
    const ledger = new Ledger(deps);

    const first = await ledger.append({
      event_id: "EVT-000", event_type: "MISSION_CREATED", mission_id: "MISSION-001",
      caused_by: [], timestamp: deps.nowIso(), payload: {}, previous_hash: null,
    });
    const second = await ledger.append({
      event_id: "EVT-001", event_type: "TASK_CREATED", mission_id: "MISSION-001", task_id: "TASK-001",
      caused_by: ["EVT-000"], timestamp: deps.nowIso(), payload: {}, previous_hash: first.event_hash,
    });
    await expect(ledger.append({
      event_id: "EVT-002", event_type: "TASK_VERIFIED", mission_id: "MISSION-001", task_id: "TASK-001",
      proof_id: "PROOF-001", caused_by: ["EVT-001"], timestamp: deps.nowIso(), payload: {}, previous_hash: second.event_hash,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects MISSION_COMPLETED without satisfied DoD", async () => {
    const ledger = new Ledger(deps);

    const first = await ledger.append({
      event_id: "EVT-000", event_type: "MISSION_CREATED", mission_id: "MISSION-001",
      caused_by: [], timestamp: deps.nowIso(), payload: {}, previous_hash: null,
    });
    await expect(ledger.append({
      event_id: "EVT-001", event_type: "MISSION_COMPLETED", mission_id: "MISSION-001",
      caused_by: ["EVT-000"], timestamp: deps.nowIso(), payload: {}, previous_hash: first.event_hash,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects events after terminal mission state", async () => {
    const ledger = new Ledger(deps);

    // Create mission and satisfy DoD
    const first = await ledger.append({
      event_id: "EVT-000", event_type: "MISSION_CREATED", mission_id: "MISSION-001",
      caused_by: [], timestamp: deps.nowIso(), payload: {}, previous_hash: null,
    });
    const second = await ledger.append({
      event_id: "EVT-001", event_type: "DOD_RECALCULATED", mission_id: "MISSION-001",
      caused_by: ["EVT-000"], timestamp: deps.nowIso(),
      payload: { BUILD: true, DEPLOY: true, HEALTH: true, SECURITY: true }, previous_hash: first.event_hash,
    });
    const third = await ledger.append({
      event_id: "EVT-002", event_type: "MISSION_COMPLETED", mission_id: "MISSION-001",
      caused_by: ["EVT-001"], timestamp: deps.nowIso(), payload: {}, previous_hash: second.event_hash,
    });

    // Attempt to append after completion
    await expect(
      ledger.append({
        event_id: "EVT-003",
        event_type: "TASK_CREATED",
        mission_id: "MISSION-001",
        task_id: "TASK-001",
        caused_by: ["EVT-002"],
        timestamp: deps.nowIso(),
        payload: {},
        previous_hash: third.event_hash,
      })
    ).rejects.toThrow(InvalidLedgerEventError);
  });

  it("reconstructs same state from exported event stream (restart recovery)", async () => {
    const ledger = new Ledger(deps);

    const first = await ledger.append({
      event_id: "EVT-000", event_type: "MISSION_CREATED", mission_id: "MISSION-001",
      caused_by: [], timestamp: deps.nowIso(), payload: {}, previous_hash: null,
    });
    await ledger.append({
      event_id: "EVT-001", event_type: "MISSION_PLANNED", mission_id: "MISSION-001",
      caused_by: ["EVT-000"], timestamp: deps.nowIso(), payload: {}, previous_hash: first.event_hash,
    });

    const exported = ledger.export();
    const reconstructed = await Ledger.replay(exported, deps);
    const state1 = ledger.reconstructState();
    const state2 = reconstructed.reconstructState();

    expect(state1.mission_status).toBe(state2.mission_status);
    expect(state1.tasks).toEqual(state2.tasks);
    expect(state1.proofs).toEqual(state2.proofs);
    expect(state1.dod).toEqual(state2.dod);
  });

  it("rejects out-of-order causal event", async () => {
    const ledger = new Ledger(deps);

    await ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_CREATED",
      mission_id: "MISSION-001",
      caused_by: [],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: null,
    });

    // Attempt to reference a future event as causal parent
    await expect(
      ledger.append({
        event_id: "EVT-001",
        event_type: "MISSION_PLANNED",
        mission_id: "MISSION-001",
        caused_by: ["EVT-002"], // does not exist yet
        timestamp: deps.nowIso(),
        payload: {},
        previous_hash: "placeholder",
      })
    ).rejects.toThrow(InvalidLedgerEventError);
  });
});
