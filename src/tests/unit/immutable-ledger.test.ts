import { describe, expect, it } from "vitest";
import { canonicalJson, digestCanonical } from "../../core/ledger/CanonicalDigest.js";
import { ImmutableLedger, LEDGER_GENESIS_DIGEST, type LedgerEvent } from "../../core/ledger/ImmutableLedger.js";

function created(eventId = "e1") {
  return { eventId, taskId: "task-1", missionId: "mission-1", eventType: "TASK_CREATED" as const, payload: { payload: { nested: "one" } } };
}

function appendRunning(ledger: ImmutableLedger, eventId: string, parentId: string) {
  return ledger.append({ eventId, taskId: "task-1", missionId: "mission-1", eventType: "TASK_STARTED", causalParentId: parentId, payload: { action: "start" } });
}

describe("immutable governed ledger", () => {
  it("uses deterministic recursive canonicalization and real SHA-256", () => {
    expect(canonicalJson({ b: 2, a: { z: true, y: null } })).toBe(canonicalJson({ a: { y: null, z: true }, b: 2 }));
    expect(digestCanonical({ payload: { secret: "one" } })).not.toBe(digestCanonical({ payload: { secret: "two" } }));
  });

  it("starts from a genesis digest and forms a verifiable chain", () => {
    const ledger = new ImmutableLedger();
    const first = ledger.append(created());
    expect(first.previousDigest).toBe(LEDGER_GENESIS_DIGEST);
    appendRunning(ledger, "e2", first.eventId);
    expect(ledger.verify()).toMatchObject({ valid: true, events: 2 });
  });

  it("deeply isolates stored payloads and returned events", () => {
    const ledger = new ImmutableLedger();
    const input = created();
    const first = ledger.append(input);
    (input.payload as { payload: { nested: string } }).payload.nested = "mutated-input";
    expect((first.payload as { payload: { nested: string } }).payload.nested).toBe("one");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.payload)).toBe(true);
    expect(Object.isFrozen((first.payload as { payload: object }).payload)).toBe(true);
    const exported = ledger.export();
    const [exportedFirst] = exported;
    if (!exportedFirst) throw new Error("missing_exported_event");
    expect(() => ((exportedFirst.payload as { payload: { nested: string } }).payload.nested = "mutated-output")).toThrow();
    expect(ledger.verify().valid).toBe(true);
  });

  it("rejects cross-mission parents, replay, and invalid terminal transitions", () => {
    const ledger = new ImmutableLedger();
    const first = ledger.append(created());
    expect(() => ledger.append({ eventId: "cross", taskId: "task-2", missionId: "mission-2", eventType: "TASK_STARTED", causalParentId: first.eventId, payload: {} })).toThrow("ledger_cross_mission_parent");
    expect(() => ledger.append(created())).toThrow("ledger_event_replay");
    const started = appendRunning(ledger, "e2", first.eventId);
    const proof = ledger.append({ eventId: "e3", taskId: "task-1", missionId: "mission-1", eventType: "PROOF_RECORDED", causalParentId: started.eventId, proofId: "proof-1", payload: { digest: "abc" } });
    const verified = ledger.append({ eventId: "e4", taskId: "task-1", missionId: "mission-1", eventType: "TASK_VERIFIED", causalParentId: proof.eventId, proofId: "proof-1", payload: { proofId: "proof-1" } });
    const completed = ledger.append({ eventId: "e5", taskId: "task-1", missionId: "mission-1", eventType: "TASK_COMPLETED", causalParentId: verified.eventId, payload: {} });
    expect(ledger.getTaskStatus("task-1", "mission-1")).toBe("done");
    expect(() => ledger.append({ eventId: "e6", taskId: "task-1", missionId: "mission-1", eventType: "TASK_STARTED", causalParentId: completed.eventId, payload: {} })).toThrow("ledger_terminal_transition");
  });

  it("requires causal proof before TASK_VERIFIED", () => {
    const ledger = new ImmutableLedger();
    const first = ledger.append(created());
    const started = appendRunning(ledger, "e2", first.eventId);
    expect(() => ledger.append({ eventId: "e3", taskId: "task-1", missionId: "mission-1", eventType: "TASK_VERIFIED", causalParentId: started.eventId, proofId: "missing", payload: {} })).toThrow("ledger_causal_verification_missing");
  });

  it("replays an exported chain and detects tampering", () => {
    const ledger = new ImmutableLedger();
    const first = ledger.append(created());
    appendRunning(ledger, "e2", first.eventId);
    const exported = ledger.export();
    const replayed = ImmutableLedger.replay(exported);
    expect(replayed.verify()).toMatchObject({ valid: true, events: 2, headDigest: ledger.headDigest() });
    const tampered = structuredClone(exported) as LedgerEvent[];
    const [, second] = tampered;
    if (!second) throw new Error("missing_second_event");
    (second.payload as { action: string }).action = "tampered";
    expect(() => ImmutableLedger.replay(tampered)).toThrow("ledger_replay_hash_mismatch:e2");
  });
});
