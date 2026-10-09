/**
 * Unit tests for GNW Immutable Progress Ledger.
 *
 * Focus:
 * - Recursive canonicalization and insertion-order independence
 * - Nested payload tamper detection
 * - Deep immutability of stored and returned events
 * - Correct previous-hash chaining
 * - Fail-closed replay/integrity behavior
 */

import { describe, it, expect } from "vitest";
import { Ledger, InvalidLedgerEventError, LedgerIntegrityError, testDependencies } from "../../executor/ledger";

const deps = testDependencies();

function baseEvent(payload: unknown = {}) {
  return {
    event_id: "EVT-000",
    event_type: "MISSION_CREATED" as const,
    mission_id: "MISSION-001",
    caused_by: [],
    timestamp: deps.nowIso(),
    payload,
    previous_hash: null,
  };
}

describe("Ledger", () => {
  it("accepts a valid causal event sequence using the actual preceding hash", async () => {
    const ledger = new Ledger(deps);
    const evt1 = await ledger.append(baseEvent());
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
    expect(evt2.previous_hash).toBe(evt1.event_hash);
  });

  it("rejects duplicate event_id", async () => {
    const ledger = new Ledger(deps);
    await ledger.append(baseEvent());

    await expect(ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_PLANNED",
      mission_id: "MISSION-001",
      caused_by: ["EVT-000"],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: null,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects missing causal parent", async () => {
    const ledger = new Ledger(deps);

    await expect(ledger.append({
      event_id: "EVT-000",
      event_type: "MISSION_PLANNED",
      mission_id: "MISSION-001",
      caused_by: ["EVT-MISSING"],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: null,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects self-causal event", async () => {
    const ledger = new Ledger(deps);

    await expect(ledger.append({
      ...baseEvent(),
      caused_by: ["EVT-000"],
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("canonicalizes nested objects independent of insertion order", async () => {
    const ledgerA = new Ledger(deps);
    const ledgerB = new Ledger(deps);

    const e1 = await ledgerA.append({
      ...baseEvent({
        outer: { b: 2, a: { y: 1, x: "✓" } },
        array: [{ z: null, a: true }, 42, "日本語"],
      }),
    });
    const e2 = await ledgerB.append({
      ...baseEvent({
        array: ["日本語", 42, { a: true, z: null }],
        outer: { a: { x: "✓", y: 1 }, b: 2 },
      }),
    });

    expect(e1.event_hash).toBe(e2.event_hash);
  });

  it("detects tampering in nested payload values during replay", async () => {
    const source = new Ledger(deps);
    const first = await source.append(baseEvent({
      nested: { keep: true, list: [1, 2, { value: "original" }] },
    }));

    const tampered = {
      ...first,
      payload: { nested: { keep: true, list: [1, 2, { value: "tampered" }] } },
    };

    await expect(Ledger.replay([tampered], deps)).rejects.toThrow(LedgerIntegrityError);
  });

  it("preserves arrays, numbers, booleans, null and Unicode in the hash", async () => {
    const ledger = new Ledger(deps);
    const event = await ledger.append(baseEvent({
      unicode: "✓ 日本語 🚀",
      number: 123.456,
      boolean: false,
      nil: null,
      nestedArray: [1, null, false, { text: "é" }],
    }));

    expect(event.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deep-clones the returned event so nested mutation cannot alter history", async () => {
    const ledger = new Ledger(deps);
    await ledger.append(baseEvent({
      nested: { list: [{ value: 1 }] },
    }));

    const retrieved = ledger.getEvent("EVT-000")!;
    (retrieved.payload as { nested: { list: Array<{ value: number }> } }).nested.list[0].value = 999;

    const again = ledger.getEvent("EVT-000")!;
    expect((again.payload as any).nested.list[0].value).toBe(1);
  });

  it("deep-clones export results so nested mutation cannot alter history", async () => {
    const ledger = new Ledger(deps);
    await ledger.append(baseEvent({
      nested: { list: [{ value: 1 }] },
    }));

    const exported = ledger.export();
    (exported[0].payload as any).nested.list[0].value = 999;

    expect((ledger.export()[0].payload as any).nested.list[0].value).toBe(1);
  });

  it("rejects an invalid previous_hash", async () => {
    const ledger = new Ledger(deps);
    const first = await ledger.append(baseEvent());

    await expect(ledger.append({
      event_id: "EVT-001",
      event_type: "MISSION_PLANNED",
      mission_id: "MISSION-001",
      caused_by: ["EVT-000"],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: "wrong-hash",
    })).rejects.toThrow(LedgerIntegrityError);

    expect(ledger.getEvent(first.event_id)).toBeDefined();
    expect(ledger.getAllEvents()).toHaveLength(1);
  });

  it("replays an exported chain without rewriting hashes", async () => {
    const ledger = new Ledger(deps);
    const evt1 = await ledger.append(baseEvent({ step: 1 }));
    const evt2 = await ledger.append({
      event_id: "EVT-001",
      event_type: "MISSION_PLANNED",
      mission_id: "MISSION-001",
      caused_by: ["EVT-000"],
      timestamp: "2026-10-05T00:00:01.000Z",
      payload: { step: 2 },
      previous_hash: evt1.event_hash,
    });

    const exported = ledger.export();
    const replayed = await Ledger.replay(exported, deps);
    const replayedEvents = replayed.getAllEvents();

    expect(replayedEvents.map(e => e.event_hash)).toEqual(
      [evt1.event_hash, evt2.event_hash]
    );
    expect(replayed.reconstructState()).toEqual(ledger.reconstructState());
  });

  it("rejects TASK_VERIFIED without prior VERIFICATION_COMPLETED", async () => {
    const ledger = new Ledger(deps);
    const evt1 = await ledger.append(baseEvent());

    await expect(ledger.append({
      event_id: "EVT-001",
      event_type: "TASK_VERIFIED",
      mission_id: "MISSION-001",
      task_id: "TASK-001",
      proof_id: "PROOF-001",
      caused_by: [evt1.event_id],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: evt1.event_hash,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects MISSION_COMPLETED without satisfied DoD", async () => {
    const ledger = new Ledger(deps);
    const evt1 = await ledger.append(baseEvent());

    await expect(ledger.append({
      event_id: "EVT-001",
      event_type: "MISSION_COMPLETED",
      mission_id: "MISSION-001",
      caused_by: [evt1.event_id],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: evt1.event_hash,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects events after terminal mission state", async () => {
    const ledger = new Ledger(deps);
    const evt1 = await ledger.append(baseEvent());
    const evt2 = await ledger.append({
      event_id: "EVT-001",
      event_type: "DOD_RECALCULATED",
      mission_id: "MISSION-001",
      caused_by: [evt1.event_id],
      timestamp: deps.nowIso(),
      payload: { BUILD: true, DEPLOY: true, HEALTH: true, SECURITY: true },
      previous_hash: evt1.event_hash,
    });
    const evt3 = await ledger.append({
      event_id: "EVT-002",
      event_type: "MISSION_COMPLETED",
      mission_id: "MISSION-001",
      caused_by: [evt2.event_id],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: evt2.event_hash,
    });

    await expect(ledger.append({
      event_id: "EVT-003",
      event_type: "TASK_CREATED",
      mission_id: "MISSION-001",
      task_id: "TASK-001",
      caused_by: [evt3.event_id],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: evt3.event_hash,
    })).rejects.toThrow(InvalidLedgerEventError);
  });

  it("rejects out-of-order causal events", async () => {
    const ledger = new Ledger(deps);
    await ledger.append(baseEvent());

    await expect(ledger.append({
      event_id: "EVT-001",
      event_type: "MISSION_PLANNED",
      mission_id: "MISSION-001",
      caused_by: ["EVT-002"],
      timestamp: deps.nowIso(),
      payload: {},
      previous_hash: (await ledger.getEvent("EVT-000"))!.event_hash,
    })).rejects.toThrow(InvalidLedgerEventError);
  });
});
