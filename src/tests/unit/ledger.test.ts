import { describe, expect, it } from "vitest";
import { ImmutableLedger, LedgerValidationError, reduceLedger } from "../../executor/ledger.js";

const mission = "MISSION-001";
const at = (second: number) => `2026-10-05T20:00:${String(second).padStart(2, "0")}.000Z`;

function appendMission(ledger: ImmutableLedger) {
  return ledger.append({
    eventId: "EVT-001",
    eventType: "MISSION_CREATED",
    missionId: mission,
    timestamp: at(0),
  });
}

describe("immutable progress ledger", () => {
  it("appends events, creates a hash chain, and reconstructs state", () => {
    const ledger = new ImmutableLedger();
    const created = appendMission(ledger);
    ledger.append({ eventId: "EVT-002", eventType: "TASK_SELECTED", missionId: mission, taskId: "TASK-001", timestamp: at(1), causedBy: [created.eventId] });
    ledger.append({ eventId: "EVT-003", eventType: "ACTION_STARTED", missionId: mission, taskId: "TASK-001", timestamp: at(2), causedBy: ["EVT-002"] });
    ledger.append({ eventId: "EVT-004", eventType: "ACTION_COMPLETED", missionId: mission, taskId: "TASK-001", timestamp: at(3), causedBy: ["EVT-003"] });
    ledger.append({ eventId: "EVT-005", eventType: "EVIDENCE_ATTACHED", missionId: mission, taskId: "TASK-001", evidenceIds: ["EV-001"], timestamp: at(4), causedBy: ["EVT-004"] });
    ledger.append({ eventId: "EVT-006", eventType: "VERIFICATION_PASSED", missionId: mission, taskId: "TASK-001", evidenceIds: ["EV-001"], timestamp: at(5), causedBy: ["EVT-005"] });
    ledger.append({ eventId: "EVT-007", eventType: "TASK_VERIFIED_COMPLETE", missionId: mission, taskId: "TASK-001", proofId: "PROOF-001", timestamp: at(6), causedBy: ["EVT-006"] });

    expect(ledger.verify()).toEqual({ valid: true, count: 7, lastHash: expect.any(String) });
    expect(ledger.state.missions[mission]?.tasks["TASK-001"]).toEqual({
      state: "VERIFIED_COMPLETE",
      verification: "VERIFIED",
      evidenceIds: ["EV-001"],
      proofId: "PROOF-001",
    });
  });

  it("rejects an unknown causal parent", () => {
    const ledger = new ImmutableLedger();
    appendMission(ledger);

    expect(() => ledger.append({
      eventId: "EVT-002",
      eventType: "TASK_SELECTED",
      missionId: mission,
      taskId: "TASK-001",
      timestamp: at(1),
      causedBy: ["EVT-MISSING"],
    })).toThrowError(new LedgerValidationError("UNKNOWN_PARENT", "causal_parent_missing:EVT-MISSING"));
  });

  it("rejects cross-mission causal parents during replay", () => {
    const first = new ImmutableLedger();
    const parent = first.append({ eventId: "EVT-A", eventType: "MISSION_CREATED", missionId: "MISSION-A", timestamp: at(0) });
    const other = new ImmutableLedger();
    other.append({ eventId: "EVT-B", eventType: "MISSION_CREATED", missionId: "MISSION-B", timestamp: at(0) });

    const candidate = {
      ...other.events[0],
      eventId: "EVT-C",
      eventType: "TASK_SELECTED" as const,
      taskId: "TASK-B",
      causedBy: [parent.eventId],
      sequence: 2,
      previousHash: other.events[0]!.hash,
    };
    const tampered = { ...candidate, hash: candidate.hash };
    expect(() => reduceLedger([other.events[0]!, tampered])).toThrowError("causal_parent_cross_mission:EVT-A");
  });

  it("rejects duplicate ids and invalid completion without verified proof", () => {
    const ledger = new ImmutableLedger();
    appendMission(ledger);
    ledger.append({ eventId: "EVT-002", eventType: "TASK_SELECTED", missionId: mission, taskId: "TASK-001", timestamp: at(1), causedBy: ["EVT-001"] });

    expect(() => ledger.append({ eventId: "EVT-002", eventType: "ACTION_STARTED", missionId: mission, taskId: "TASK-001", timestamp: at(2) }))
      .toThrowError("duplicate_event_id:EVT-002");

    expect(() => ledger.append({ eventId: "EVT-003", eventType: "TASK_VERIFIED_COMPLETE", missionId: mission, taskId: "TASK-001", timestamp: at(2) }))
      .toThrowError("task_completion_requires_verified_result");
  });

  it("does not expose mutable internal events", () => {
    const ledger = new ImmutableLedger();
    appendMission(ledger);
    const events = ledger.events as Array<Record<string, unknown>>;
    events[0]!.eventId = "TAMPERED";
    expect(ledger.events[0]?.eventId).toBe("EVT-001");
    expect(ledger.verify().valid).toBe(true);
  });

  it("fails closed when a replay contains a duplicate event", () => {
    const ledger = new ImmutableLedger();
    appendMission(ledger);
    const events = ledger.events;
    expect(() => reduceLedger([...events, events[0]!])).toThrowError("duplicate_event_id:EVT-001");
  });
});
