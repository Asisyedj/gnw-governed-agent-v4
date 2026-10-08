import { canonicalJson, digestCanonical, equalDigest, type JsonValue } from "./CanonicalDigest.js";

export const LEDGER_GENESIS_DIGEST = "0".repeat(64);

export type LedgerEventType =
  | "TASK_CREATED"
  | "TASK_STARTED"
  | "TASK_WAITING_APPROVAL"
  | "PROOF_RECORDED"
  | "TASK_VERIFIED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCELLED"
  | "EXECUTION_REQUESTED"
  | "EXECUTION_ADMITTED"
  | "EXECUTION_DENIED"
  | "EXECUTION_COMPLETED"
  | "EXECUTION_FAILED";

export type LedgerTaskStatus = "created" | "running" | "waiting_approval" | "verified" | "done" | "failed" | "cancelled";

export type LedgerEventInput = {
  eventId: string;
  taskId: string;
  missionId: string;
  eventType: LedgerEventType;
  causalParentId?: string;
  proofId?: string;
  payload: JsonValue;
};

export type LedgerEvent = Readonly<LedgerEventInput & {
  previousDigest: string;
  eventHash: string;
}>;

export type LedgerVerification = Readonly<{
  valid: boolean;
  events: number;
  headDigest: string;
  reason?: string;
}>;

const terminal = new Set<LedgerTaskStatus>(["done", "failed", "cancelled"]);

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) result[key] = cloneJson(child);
  return result;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function immutableCopy<T extends object>(value: T): Readonly<T> {
  return freezeDeep(structuredClone(value));
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) throw new Error(`ledger_${label}_invalid`);
}

function nextStatus(current: LedgerTaskStatus | undefined, event: LedgerEventInput): LedgerTaskStatus {
  if (event.eventType === "TASK_CREATED") {
    if (current !== undefined) throw new Error("ledger_task_already_created");
    return "created";
  }
  if (current === undefined) throw new Error("ledger_task_not_created");
  if (terminal.has(current)) throw new Error("ledger_terminal_transition");
  switch (event.eventType) {
    case "TASK_STARTED":
      if (current !== "created" && current !== "waiting_approval") throw new Error("ledger_invalid_started_transition");
      return "running";
    case "TASK_WAITING_APPROVAL":
      if (current !== "running") throw new Error("ledger_invalid_approval_transition");
      return "waiting_approval";
    case "PROOF_RECORDED":
      if (current !== "running" && current !== "waiting_approval") throw new Error("ledger_invalid_proof_transition");
      return current;
    case "EXECUTION_REQUESTED":
    case "EXECUTION_ADMITTED":
    case "EXECUTION_DENIED":
    case "EXECUTION_COMPLETED":
    case "EXECUTION_FAILED":
      if (current !== "running" && current !== "waiting_approval" && current !== "verified") throw new Error("ledger_invalid_execution_transition");
      return current;
    case "TASK_VERIFIED":
      if (current !== "running" && current !== "waiting_approval") throw new Error("ledger_invalid_verified_transition");
      if (!event.proofId) throw new Error("ledger_verification_proof_required");
      return "verified";
    case "TASK_COMPLETED":
      if (current !== "verified") throw new Error("ledger_invalid_completed_transition");
      return "done";
    case "TASK_FAILED":
      return "failed";
    case "TASK_CANCELLED":
      return "cancelled";
    default:
      throw new Error("ledger_event_type_invalid");
  }
}

export class ImmutableLedger {
  private readonly events: LedgerEvent[] = [];
  private readonly taskStates = new Map<string, LedgerTaskStatus>();
  private readonly taskEventIds = new Map<string, Set<string>>();
  private readonly eventIds = new Set<string>();

  append(input: LedgerEventInput): LedgerEvent {
    requireText(input.eventId, "event_id");
    requireText(input.taskId, "task_id");
    requireText(input.missionId, "mission_id");
    if (this.eventIds.has(input.eventId)) throw new Error("ledger_event_replay");
    const key = `${input.missionId}:${input.taskId}`;
    const current = this.taskStates.get(key);
    if (input.eventType === "TASK_CREATED" && input.causalParentId !== undefined) throw new Error("ledger_created_cannot_have_parent");
    if (input.eventType !== "TASK_CREATED" && !input.causalParentId) throw new Error("ledger_causal_parent_required");
    if (input.causalParentId) {
      const parent = this.events.find(event => event.eventId === input.causalParentId);
      if (!parent) throw new Error("ledger_causal_parent_missing");
      if (parent.taskId !== input.taskId || parent.missionId !== input.missionId) throw new Error("ledger_cross_mission_parent");
    }
    const status = nextStatus(current, input);
    if (input.eventType === "TASK_VERIFIED") {
      const prior = this.taskEventIds.get(key) ?? new Set<string>();
      const hasProof = this.events.some(event => event.taskId === input.taskId && event.missionId === input.missionId && event.eventType === "PROOF_RECORDED" && event.proofId === input.proofId);
      if (!prior.size || !hasProof) throw new Error("ledger_causal_verification_missing");
    }
    const payload = cloneJson(input.payload);
    const previousDigest = this.events.at(-1)?.eventHash ?? LEDGER_GENESIS_DIGEST;
    const eventHash = digestCanonical({ ...input, payload }, previousDigest);
    const event = immutableCopy({ ...input, payload, previousDigest, eventHash }) as LedgerEvent;
    this.events.push(event);
    this.eventIds.add(event.eventId);
    this.taskStates.set(key, status);
    const ids = this.taskEventIds.get(key) ?? new Set<string>();
    ids.add(event.eventId);
    this.taskEventIds.set(key, ids);
    return immutableCopy(event);
  }

  getEvent(eventId: string): LedgerEvent | undefined {
    const event = this.events.find(candidate => candidate.eventId === eventId);
    return event ? immutableCopy(event) : undefined;
  }

  getAllEvents(): readonly LedgerEvent[] {
    return immutableCopy(this.events);
  }

  getTaskStatus(taskId: string, missionId: string): LedgerTaskStatus | undefined {
    return this.taskStates.get(`${missionId}:${taskId}`);
  }

  headDigest(): string {
    return this.events.at(-1)?.eventHash ?? LEDGER_GENESIS_DIGEST;
  }

  verify(): LedgerVerification {
    let previousDigest = LEDGER_GENESIS_DIGEST;
    try {
      for (const event of this.events) {
        const expected = digestCanonical({
          eventId: event.eventId,
          taskId: event.taskId,
          missionId: event.missionId,
          eventType: event.eventType,
          ...(event.causalParentId === undefined ? {} : { causalParentId: event.causalParentId }),
          ...(event.proofId === undefined ? {} : { proofId: event.proofId }),
          payload: event.payload,
        }, previousDigest);
        if (event.previousDigest !== previousDigest || !equalDigest(event.eventHash, expected)) {
          return { valid: false, events: this.events.length, headDigest: this.headDigest(), reason: `ledger_hash_mismatch:${event.eventId}` };
        }
        previousDigest = event.eventHash;
      }
      return { valid: true, events: this.events.length, headDigest: previousDigest };
    } catch (error) {
      return { valid: false, events: this.events.length, headDigest: this.headDigest(), reason: error instanceof Error ? error.message : String(error) };
    }
  }

  export(): readonly LedgerEvent[] {
    return this.getAllEvents();
  }

  static replay(events: readonly LedgerEvent[]): ImmutableLedger {
    const ledger = new ImmutableLedger();
    for (const event of events) {
      const replayed = ledger.append({
        eventId: event.eventId,
        taskId: event.taskId,
        missionId: event.missionId,
        eventType: event.eventType,
        ...(event.causalParentId === undefined ? {} : { causalParentId: event.causalParentId }),
        ...(event.proofId === undefined ? {} : { proofId: event.proofId }),
        payload: cloneJson(event.payload),
      });
      if (replayed.previousDigest !== event.previousDigest || !equalDigest(replayed.eventHash, event.eventHash)) throw new Error(`ledger_replay_hash_mismatch:${event.eventId}`);
    }
    return ledger;
  }
}

export function canonicalLedgerInput(input: LedgerEventInput): string {
  return canonicalJson(input);
}
