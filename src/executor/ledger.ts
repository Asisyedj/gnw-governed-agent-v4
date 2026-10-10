/**
 * GNW Immutable Progress Ledger
 *
 * Responsibilities:
 * - Typed event definitions
 * - Append-only event insertion with hash-chain integrity
 * - Causality validation (no missing parents, no self-causation, no out-of-order)
 * - Immutable snapshots and read-only retrieval
 * - Deterministic state reconstruction via replay
 * - Fail-closed rejection of invalid events
 *
 * Non-responsibilities (explicitly excluded):
 * - Priority scoring
 * - Verification policy enforcement
 * - Mission planning or task selection logic
 * - Silent repair of invalid sequences
 */

export type LedgerEventType =
  | "MISSION_CREATED"
  | "MISSION_PLANNED"
  | "TASK_CREATED"
  | "TASK_SELECTED"
  | "ACTION_STARTED"
  | "ACTION_COMPLETED"
  | "EVIDENCE_ATTACHED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_COMPLETED"
  | "TASK_VERIFIED"
  | "DOD_RECALCULATED"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED";

export interface LedgerEvent {
  event_id: string;
  event_type: LedgerEventType;
  mission_id: string;
  task_id?: string;
  proof_id?: string;
  caused_by: string[]; // event_ids of causal parents
  timestamp: string; // ISO 8601, authoritative as stored
  payload: unknown;
  previous_hash: string | null; // hash of immediately preceding event in append order
  event_hash: string; // hash of this event's canonical representation
}

export type MissionStatus = "CREATED" | "PLANNED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface LedgerState {
  mission_status: MissionStatus;
  tasks: Record<string, {
    status: "NOT_STARTED" | "IN_PROGRESS" | "AWAITING_EVIDENCE" | "AWAITING_VERIFICATION" | "VERIFIED_COMPLETE" | "BLOCKED" | "FAILED";
    proof_id?: string;
  }>;
  proofs: Record<string, unknown>;
  dod: Record<string, boolean>;
}

export class InvalidLedgerEventError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly reason: string
  ) {
    super(`Invalid ledger event ${eventId}: ${reason}`);
    this.name = "InvalidLedgerEventError";
  }
}

export class LedgerIntegrityError extends Error {
  constructor(public readonly reason: string) {
    super(`Ledger integrity violation: ${reason}`);
    this.name = "LedgerIntegrityError";
  }
}

/**
 * Injected dependencies for deterministic behavior and testability.
 */
export interface LedgerDependencies {
  /** Generate a unique event ID. In production use UUID; in tests use fixed IDs. */
  generateEventId: () => string;
  /** Get current timestamp as ISO 8601. In tests, return fixed timestamps. */
  nowIso: () => string;
  /** Hash function: returns hex string. In tests, can be mocked. */
  hash: (input: string) => Promise<string>;
}

/**
 * Canonical JSON representation for hashing (stable key order).
 */
function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

/**
 * Compute event hash from its fields (excluding event_hash itself).
 */
function cloneLedgerEvent(event: LedgerEvent): LedgerEvent {
  return structuredClone(event);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      freezeDeep((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

async function computeEventHash(event: Omit<LedgerEvent, "event_hash">, hashFn: (input: string) => Promise<string>): Promise<string> {
  const canonical = canonicalJson({
    event_id: event.event_id,
    event_type: event.event_type,
    mission_id: event.mission_id,
    task_id: event.task_id,
    proof_id: event.proof_id,
    caused_by: event.caused_by,
    timestamp: event.timestamp,
    payload: event.payload,
    previous_hash: event.previous_hash,
  });
  return hashFn(canonical);
}

/**
 * Internal ledger storage (append-only in memory; exportable as event array).
 */
export class Ledger {
  private readonly events: LedgerEvent[] = [];
  private readonly eventIndex: Map<string, number> = new Map();
  private readonly hashFn: (input: string) => Promise<string>;

  constructor(private readonly deps: LedgerDependencies) {
    this.hashFn = deps.hash;
  }

  /**
   * Append a new event with full validation.
   * Returns the appended event if successful.
   * Throws InvalidLedgerEventError or LedgerIntegrityError on violation.
   */
  async append(
    event: Omit<LedgerEvent, "event_hash"> & { event_hash?: string }
  ): Promise<LedgerEvent> {
    // Copy caller-owned data before hashing or storing it, so later mutations cannot alter ledger history.
    const safeEvent = structuredClone(event);

    // 1. Duplicate event_id check
    if (this.eventIndex.has(safeEvent.event_id)) {
      throw new InvalidLedgerEventError(safeEvent.event_id, "duplicate event_id");
    }

    // 2. Causality validation
    for (const parentId of safeEvent.caused_by) {
      if (parentId === safeEvent.event_id) {
        throw new InvalidLedgerEventError(safeEvent.event_id, "self-causation");
      }
      if (!this.eventIndex.has(parentId)) {
        throw new InvalidLedgerEventError(safeEvent.event_id, `missing causal parent ${parentId}`);
      }
    }

    // 3. Hash integrity: compute and compare (if provided)
    const computedHash = await computeEventHash(safeEvent, this.hashFn);
    if (safeEvent.event_hash !== undefined && safeEvent.event_hash !== computedHash) {
      throw new LedgerIntegrityError(`hash mismatch for event ${safeEvent.event_id}`);
    }

    // 4. Previous hash chain validation
    const expectedPreviousHash = this.events.at(-1)?.event_hash ?? null;
    if (safeEvent.previous_hash !== expectedPreviousHash) {
      throw new LedgerIntegrityError(`invalid previous_hash for event ${safeEvent.event_id}`);
    }

    // 5. State transition validation (fail-closed)
    this.validateTransition(safeEvent);

    // 6. Construct and deeply freeze the canonical stored event.
    const finalEvent: LedgerEvent = freezeDeep({
      ...safeEvent,
      caused_by: [...safeEvent.caused_by],
      payload: structuredClone(safeEvent.payload),
      event_hash: computedHash,
    });

    // 7. Append (immutable: never modify existing events)
    this.events.push(finalEvent);
    this.eventIndex.set(finalEvent.event_id, this.events.length - 1);

    // Never expose references to the canonical stored event.
    return cloneLedgerEvent(finalEvent);
  }

  /**
   * Validate state transitions based on event type.
   * Throws InvalidLedgerEventError on invalid transition.
   */
  private validateTransition(event: Omit<LedgerEvent, "event_hash">): void {
    const currentStatus = this.getCurrentMissionStatus();

    // No event after terminal mission state
    if (currentStatus === "COMPLETED" || currentStatus === "FAILED") {
      throw new InvalidLedgerEventError(
        event.event_id,
        `event after terminal mission state ${currentStatus}`
      );
    }

    // TASK_VERIFIED requires prior VERIFICATION_COMPLETED
    if (event.event_type === "TASK_VERIFIED") {
      const hasVerificationCompleted = this.events.some(
        e => e.event_type === "VERIFICATION_COMPLETED" && e.task_id === event.task_id
      );
      if (!hasVerificationCompleted) {
        throw new InvalidLedgerEventError(
          event.event_id,
          "TASK_VERIFIED without prior VERIFICATION_COMPLETED"
        );
      }
    }

    // MISSION_COMPLETED requires satisfied DoD (all dod entries true)
    if (event.event_type === "MISSION_COMPLETED") {
      const dodEntries = Object.entries(this.getCurrentDod());
      if (dodEntries.length === 0 || !dodEntries.every(([, satisfied]) => satisfied)) {
        throw new InvalidLedgerEventError(
          event.event_id,
          "MISSION_COMPLETED without satisfied DoD"
        );
      }
    }
  }

  private getCurrentMissionStatus(): MissionStatus {
    // Replay-derived status from events
    let status: MissionStatus = "CREATED";
    for (const e of this.events) {
      switch (e.event_type) {
        case "MISSION_CREATED":
          status = "CREATED";
          break;
        case "MISSION_PLANNED":
          status = "PLANNED";
          break;
        case "MISSION_COMPLETED":
          status = "COMPLETED";
          break;
        case "MISSION_FAILED":
          status = "FAILED";
          break;
        default:
          if (status === "PLANNED") status = "RUNNING";
          break;
      }
    }
    return status;
  }

  private getCurrentDod(): Record<string, boolean> {
    const dod: Record<string, boolean> = {};
    for (const e of this.events) {
      if (e.event_type === "DOD_RECALCULATED" && typeof e.payload === "object" && e.payload !== null) {
        Object.assign(dod, e.payload as Record<string, boolean>);
      }
    }
    return dod;
  }

  /**
   * Read-only retrieval: get event by ID.
   */
  getEvent(eventId: string): LedgerEvent | undefined {
    const idx = this.eventIndex.get(eventId);
    if (idx === undefined) return undefined;
    const event = this.events[idx];
    return event ? cloneLedgerEvent(event) : undefined;
  }

  /**
   * Read-only retrieval: get all events (immutable copy).
   */
  getAllEvents(): LedgerEvent[] {
    return this.events.map(cloneLedgerEvent);
  }

  /**
   * Export the entire event stream for persistence or replay.
   */
  export(): LedgerEvent[] {
    return this.getAllEvents();
  }

  /**
   * Import and replay an event stream, reconstructing state.
   * Returns a new Ledger instance with replayed events.
   * Throws on first invalid event (fail-closed).
   */
  static async replay(
    events: LedgerEvent[],
    deps: LedgerDependencies
  ): Promise<Ledger> {
    const ledger = new Ledger(deps);
    for (const event of events) {
      await ledger.append(event);
    }
    return ledger;
  }

  /**
   * Reconstruct current state by replaying all events.
   * Returns a fresh LedgerState.
   */
  reconstructState(): LedgerState {
    const state: LedgerState = {
      mission_status: "CREATED",
      tasks: {},
      proofs: {},
      dod: {},
    };

    for (const event of this.events) {
      this.reduceInPlace(state, event);
    }

    return state;
  }

  /**
   * Pure reducer: apply a single event to state, returning new state.
   * Throws InvalidLedgerEventError on invalid transition.
   */
  reduce(state: LedgerState, event: LedgerEvent): LedgerState {
    // Validate transition (same rules as append)
    this.validateTransitionAgainstState(state, event);

    const newState: LedgerState = {
      mission_status: state.mission_status,
      tasks: { ...state.tasks },
      proofs: { ...state.proofs },
      dod: { ...state.dod },
    };

    this.reduceInPlace(newState, event);
    return newState;
  }

  private reduceInPlace(state: LedgerState, event: LedgerEvent): void {
    switch (event.event_type) {
      case "MISSION_CREATED":
        state.mission_status = "CREATED";
        break;
      case "MISSION_PLANNED":
        state.mission_status = "PLANNED";
        break;
      case "TASK_CREATED":
        if (event.task_id) {
          state.tasks[event.task_id] = { status: "NOT_STARTED" };
        }
        break;
      case "TASK_SELECTED":
        if (event.task_id) {
          state.tasks[event.task_id] = { ...(state.tasks[event.task_id] || { status: "NOT_STARTED" }), status: "IN_PROGRESS" };
        }
        break;
      case "ACTION_STARTED":
        // Optional: track action state if needed
        break;
      case "ACTION_COMPLETED":
        // Optional: track action completion
        break;
      case "EVIDENCE_ATTACHED":
        // Optional: track evidence
        break;
      case "VERIFICATION_STARTED":
        if (event.task_id) {
          state.tasks[event.task_id] = { ...(state.tasks[event.task_id] || { status: "NOT_STARTED" }), status: "AWAITING_VERIFICATION" };
        }
        break;
      case "VERIFICATION_COMPLETED":
        // Transition handled by reducer validation
        break;
      case "TASK_VERIFIED":
        if (event.task_id) {
          state.tasks[event.task_id] = {
            ...(state.tasks[event.task_id] || { status: "NOT_STARTED" }),
            status: "VERIFIED_COMPLETE",
            ...(event.proof_id !== undefined ? { proof_id: event.proof_id } : {}),
          };
        }
        break;
      case "DOD_RECALCULATED":
        if (typeof event.payload === "object" && event.payload !== null) {
          Object.assign(state.dod, event.payload as Record<string, boolean>);
        }
        break;
      case "MISSION_COMPLETED":
        state.mission_status = "COMPLETED";
        break;
      case "MISSION_FAILED":
        state.mission_status = "FAILED";
        break;
    }
  }

  private validateTransitionAgainstState(state: LedgerState, event: LedgerEvent): void {
    // No event after terminal mission state
    if (state.mission_status === "COMPLETED" || state.mission_status === "FAILED") {
      throw new InvalidLedgerEventError(
        event.event_id,
        `event after terminal mission state ${state.mission_status}`
      );
    }

    // TASK_VERIFIED requires prior VERIFICATION_COMPLETED
    if (event.event_type === "TASK_VERIFIED") {
      const hasVerificationCompleted = this.events.some(
        e => e.event_type === "VERIFICATION_COMPLETED" && e.task_id === event.task_id
      );
      if (!hasVerificationCompleted) {
        throw new InvalidLedgerEventError(
          event.event_id,
          "TASK_VERIFIED without prior VERIFICATION_COMPLETED"
        );
      }
    }

    // MISSION_COMPLETED requires satisfied DoD
    if (event.event_type === "MISSION_COMPLETED") {
      const dodEntries = Object.entries(state.dod);
      if (dodEntries.length === 0 || !dodEntries.every(([, satisfied]) => satisfied)) {
        throw new InvalidLedgerEventError(
          event.event_id,
          "MISSION_COMPLETED without satisfied DoD"
        );
      }
    }
  }
}

/**
 * Default hash function using Web Crypto API (production).
 */
async function defaultHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Default dependencies for production use.
 */
export function defaultDependencies(): LedgerDependencies {
  let counter = 0;
  return {
    generateEventId: () => `EVT-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    nowIso: () => new Date().toISOString(),
    hash: defaultHash,
  };
}

/**
 * Deterministic test dependencies (fixed IDs and timestamps).
 */
export function testDependencies(): LedgerDependencies {
  let counter = 0;
  return {
    generateEventId: () => `EVT-${String(counter++).padStart(3, "0")}`,
    nowIso: () => "2026-10-05T00:00:00.000Z",
    hash: async (input: string) => {
      // Simple deterministic hash for tests (not cryptographically secure)
      let hash = 0;
      for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(16).padStart(64, "0");
    },
  };
}
