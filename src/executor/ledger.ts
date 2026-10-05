import { createHash } from "node:crypto";

export const LEDGER_EVENT_TYPES = [
  "MISSION_CREATED",
  "MISSION_PLANNED",
  "TASK_SELECTED",
  "ACTION_STARTED",
  "ACTION_COMPLETED",
  "EVIDENCE_ATTACHED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "VERIFICATION_INCONCLUSIVE",
  "TASK_VERIFIED_COMPLETE",
  "TASK_BLOCKED",
  "TASK_FAILED",
  "PRIORITY_RECALCULATED",
  "CONTEXT_SWITCH_REQUESTED",
  "CONTEXT_SWITCH_ACCEPTED",
  "CONTEXT_SWITCH_REJECTED",
  "DOD_RECALCULATED",
  "MISSION_COMPLETED",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export const TASK_LEDGER_STATES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_EVIDENCE",
  "AWAITING_VERIFICATION",
  "VERIFIED_COMPLETE",
  "BLOCKED",
  "FAILED",
] as const;
export type TaskLedgerState = (typeof TASK_LEDGER_STATES)[number];

export const VERIFICATION_RESULTS = ["VERIFIED", "FAILED", "INCONCLUSIVE"] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ContractReference {
  contractId: string;
  version: string;
  hash: string;
}

export interface LedgerEventInput {
  eventId: string;
  eventType: LedgerEventType;
  missionId: string;
  taskId?: string;
  causedBy?: readonly string[];
  decisionEventId?: string;
  evidenceIds?: readonly string[];
  proofId?: string;
  contractRef?: ContractReference;
  timestamp: string;
  detail?: JsonValue;
}

export interface LedgerEvent extends LedgerEventInput {
  readonly sequence: number;
  readonly previousHash: string | null;
  readonly hash: string;
}

export interface TaskLedgerRecord {
  readonly state: TaskLedgerState;
  readonly verification: VerificationResult | null;
  readonly evidenceIds: readonly string[];
  readonly proofId: string | null;
}

export interface MissionLedgerState {
  readonly status: "ACTIVE" | "COMPLETED";
  readonly activeTaskId: string | null;
  readonly tasks: Readonly<Record<string, TaskLedgerRecord>>;
}

export interface LedgerState {
  readonly sequence: number;
  readonly lastHash: string | null;
  readonly missions: Readonly<Record<string, MissionLedgerState>>;
}

export class LedgerValidationError extends Error {
  readonly code:
    | "DUPLICATE_EVENT_ID"
    | "INVALID_SEQUENCE"
    | "UNKNOWN_PARENT"
    | "FUTURE_PARENT"
    | "CROSS_MISSION_PARENT"
    | "UNKNOWN_DECISION_EVENT"
    | "CROSS_MISSION_DECISION"
    | "CAUSAL_CYCLE"
    | "INVALID_TIMESTAMP"
    | "HASH_MISMATCH"
    | "INVALID_TRANSITION";

  constructor(code: LedgerValidationError["code"], message: string) {
    super(message);
    this.name = "LedgerValidationError";
    this.code = code;
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new LedgerValidationError("INVALID_TRANSITION", `${name}_required`);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function hashEvent(event: Omit<LedgerEvent, "hash">): string {
  return createHash("sha256").update(canonicalize(event)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function cloneForRead<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasEvent(events: readonly LedgerEvent[], eventId: string): LedgerEvent | undefined {
  return events.find((event) => event.eventId === eventId);
}

function validateTimestamp(timestamp: string): void {
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new LedgerValidationError("INVALID_TIMESTAMP", "invalid_event_timestamp");
  }
}

function validateCausality(events: readonly LedgerEvent[], candidate: LedgerEventInput, sequence: number): void {
  const parents = [...new Set(candidate.causedBy ?? [])];
  for (const parentId of parents) {
    const parent = hasEvent(events, parentId);
    if (!parent) throw new LedgerValidationError("UNKNOWN_PARENT", `causal_parent_missing:${parentId}`);
    if (parent.sequence >= sequence) throw new LedgerValidationError("FUTURE_PARENT", `causal_parent_not_prior:${parentId}`);
    if (parent.missionId !== candidate.missionId) {
      throw new LedgerValidationError("CROSS_MISSION_PARENT", `causal_parent_cross_mission:${parentId}`);
    }
  }

  if (candidate.decisionEventId) {
    const decision = hasEvent(events, candidate.decisionEventId);
    if (!decision) throw new LedgerValidationError("UNKNOWN_DECISION_EVENT", `decision_event_missing:${candidate.decisionEventId}`);
    if (decision.sequence >= sequence) throw new LedgerValidationError("FUTURE_PARENT", `decision_event_not_prior:${candidate.decisionEventId}`);
    if (decision.missionId !== candidate.missionId) {
      throw new LedgerValidationError("CROSS_MISSION_DECISION", `decision_event_cross_mission:${candidate.decisionEventId}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (eventId: string): void => {
    if (visiting.has(eventId)) throw new LedgerValidationError("CAUSAL_CYCLE", `causal_cycle:${eventId}`);
    if (visited.has(eventId)) return;
    const event = hasEvent(events, eventId);
    if (!event) return;
    visiting.add(eventId);
    for (const parentId of event.causedBy ?? []) walk(parentId);
    if (event.decisionEventId) walk(event.decisionEventId);
    visiting.delete(eventId);
    visited.add(eventId);
  };
  for (const parentId of parents) walk(parentId);
  if (candidate.decisionEventId) walk(candidate.decisionEventId);
}

function taskState(state: MissionLedgerState, taskId: string): TaskLedgerRecord {
  return state.tasks[taskId] ?? { state: "NOT_STARTED", verification: null, evidenceIds: [], proofId: null };
}

function replaceTask(state: MissionLedgerState, taskId: string, task: TaskLedgerRecord): MissionLedgerState {
  return { ...state, tasks: { ...state.tasks, [taskId]: task } };
}

function validateEventIntegrity(
  allEvents: readonly LedgerEvent[],
  event: LedgerEvent,
  seen: ReadonlySet<string>,
  expectedSequence: number,
  previousHash: string | null,
): void {
  if (seen.has(event.eventId)) throw new LedgerValidationError("DUPLICATE_EVENT_ID", `duplicate_event_id:${event.eventId}`);
  if (event.sequence !== expectedSequence) throw new LedgerValidationError("INVALID_SEQUENCE", `expected_sequence:${expectedSequence}`);
  validateTimestamp(event.timestamp);
  validateCausality(allEvents.slice(0, event.sequence - 1), event, event.sequence);
  if (event.previousHash !== previousHash) throw new LedgerValidationError("HASH_MISMATCH", `previous_hash_mismatch:${event.eventId}`);
  const { hash: _hash, ...eventWithoutHash } = event;
  if (event.hash !== hashEvent(eventWithoutHash)) {
    throw new LedgerValidationError("HASH_MISMATCH", `event_hash_mismatch:${event.eventId}`);
  }
}

function applyEvent(state: LedgerState, event: LedgerEvent): LedgerState {
  const existing = state.missions[event.missionId];
  const mission: MissionLedgerState = existing ?? { status: "ACTIVE", activeTaskId: null, tasks: {} };

  if (event.eventType === "MISSION_CREATED" && existing) {
    throw new LedgerValidationError("INVALID_TRANSITION", `mission_already_exists:${event.missionId}`);
  }
  if (event.eventType !== "MISSION_CREATED" && !existing) {
    throw new LedgerValidationError("INVALID_TRANSITION", `mission_not_created:${event.missionId}`);
  }

  let nextMission = mission;
  if (event.taskId) {
    const current = taskState(mission, event.taskId);
    let nextTask = current;
    switch (event.eventType) {
      case "TASK_SELECTED":
        if (current.state === "VERIFIED_COMPLETE") throw new LedgerValidationError("INVALID_TRANSITION", "verified_task_cannot_be_selected");
        nextTask = { ...current, state: "IN_PROGRESS" };
        nextMission = { ...nextMission, activeTaskId: event.taskId };
        break;
      case "ACTION_STARTED":
        if (mission.activeTaskId !== event.taskId) throw new LedgerValidationError("INVALID_TRANSITION", "action_task_is_not_active");
        nextTask = { ...current, state: "IN_PROGRESS" };
        break;
      case "ACTION_COMPLETED":
        if (mission.activeTaskId !== event.taskId) throw new LedgerValidationError("INVALID_TRANSITION", "action_task_is_not_active");
        nextTask = { ...current, state: "AWAITING_EVIDENCE" };
        break;
      case "EVIDENCE_ATTACHED":
        if (!event.evidenceIds?.length) throw new LedgerValidationError("INVALID_TRANSITION", "evidence_ids_required");
        nextTask = { ...current, state: "AWAITING_VERIFICATION", evidenceIds: [...new Set([...current.evidenceIds, ...event.evidenceIds])] };
        break;
      case "VERIFICATION_STARTED":
        nextTask = { ...current, state: "AWAITING_VERIFICATION" };
        break;
      case "VERIFICATION_PASSED":
        nextTask = { ...current, state: "AWAITING_VERIFICATION", verification: "VERIFIED" };
        break;
      case "VERIFICATION_FAILED":
        nextTask = { ...current, state: "FAILED", verification: "FAILED" };
        break;
      case "VERIFICATION_INCONCLUSIVE":
        nextTask = { ...current, state: "AWAITING_VERIFICATION", verification: "INCONCLUSIVE" };
        break;
      case "TASK_VERIFIED_COMPLETE":
        if (current.verification !== "VERIFIED") throw new LedgerValidationError("INVALID_TRANSITION", "task_completion_requires_verified_result");
        if (!current.evidenceIds.length) throw new LedgerValidationError("INVALID_TRANSITION", "task_completion_requires_evidence");
        if (!event.proofId) throw new LedgerValidationError("INVALID_TRANSITION", "task_completion_requires_proof");
        nextTask = { ...current, state: "VERIFIED_COMPLETE", proofId: event.proofId };
        if (mission.activeTaskId === event.taskId) nextMission = { ...nextMission, activeTaskId: null };
        break;
      case "TASK_BLOCKED":
        nextTask = { ...current, state: "BLOCKED" };
        break;
      case "TASK_FAILED":
        nextTask = { ...current, state: "FAILED", verification: "FAILED" };
        break;
      default:
        break;
    }
    if (nextTask !== current) nextMission = replaceTask(nextMission, event.taskId, nextTask);
  }

  if (event.eventType === "MISSION_COMPLETED") nextMission = { ...nextMission, status: "COMPLETED", activeTaskId: null };
  return { sequence: event.sequence, lastHash: event.hash, missions: { ...state.missions, [event.missionId]: nextMission } };
}

export function reduceLedger(events: readonly LedgerEvent[]): LedgerState {
  let state: LedgerState = { sequence: 0, lastHash: null, missions: {} };
  const seen = new Set<string>();

  for (const event of events) {
    validateEventIntegrity(events, event, seen, state.sequence + 1, state.lastHash);
    state = applyEvent(state, event);
    seen.add(event.eventId);
  }

  return deepFreeze(state);
}

export function createLedgerEvent(input: LedgerEventInput, sequence: number, previousHash: string | null): LedgerEvent {
  assertNonEmpty(input.eventId, "event_id");
  assertNonEmpty(input.missionId, "mission_id");
  if (!(LEDGER_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    throw new LedgerValidationError("INVALID_TRANSITION", `unknown_event_type:${String(input.eventType)}`);
  }
  const event = { ...input, sequence, previousHash } as Omit<LedgerEvent, "hash">;
  return deepFreeze({ ...event, hash: hashEvent(event) });
}

export class ImmutableLedger {
  #events: LedgerEvent[] = [];

  append(input: LedgerEventInput): LedgerEvent {
    if (this.#events.some((event) => event.eventId === input.eventId)) {
      throw new LedgerValidationError("DUPLICATE_EVENT_ID", `duplicate_event_id:${input.eventId}`);
    }
    validateTimestamp(input.timestamp);
    validateCausality(this.#events, input, this.#events.length + 1);
    const event = createLedgerEvent(input, this.#events.length + 1, this.#events.at(-1)?.hash ?? null);
    const candidate = [...this.#events, event];
    reduceLedger(candidate);
    this.#events.push(event);
    return cloneForRead(event);
  }

  get events(): readonly LedgerEvent[] {
    return cloneForRead(this.#events);
  }

  get state(): LedgerState {
    return reduceLedger(this.#events);
  }

  verify(): { valid: true; count: number; lastHash: string | null } {
    const state = reduceLedger(this.#events);
    return { valid: true, count: this.#events.length, lastHash: state.lastHash };
  }
}
