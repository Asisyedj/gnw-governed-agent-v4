/**
 * GNW Immutable Ledger - Event-Sourced Canonical Implementation
 * feat(ledger): Complete immutable event-sourced ledger with SHA-256 hash chaining
 */

import { createHash } from 'crypto';

/**
 * Canonical JSON serialization per RFC 8785
 * Ensures deterministic byte representation for hashing
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }

  const keys = Object.keys(value as object).sort();
  const pairs = keys.map(key => {
    const k = JSON.stringify(key);
    const v = canonicalJson((value as Record<string, unknown>)[key]);
    return `${k}:${v}`;
  });

  return '{' + pairs.join(',') + '}';
}

/**
 * Deep freeze an object to ensure immutability
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  Object.freeze(obj);

  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'object' && value !== null) {
      deepFreeze(value);
    }
  }

  return obj;
}

/**
 * Compute SHA-256 hash of input data
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Ledger entry interface
 */
export interface LedgerEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly previousHash: string;
  readonly hash: string;
  readonly version: number;
}

/**
 * In-memory sequential lock to prevent concurrent append overwrites
 */
class SequentialLock {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Immutable Event-Sourced Ledger
 */
export class ImmutableLedger {
  private entries: LedgerEntry[] = [];
  private lock = new SequentialLock();
  private versionCounter = 0;

  /**
   * Get the genesis hash (empty state)
   */
  private getGenesisHash(): string {
    return sha256('GENESIS');
  }

  /**
   * Get the latest hash in the chain
   */
  private getLatestHash(): string {
    if (this.entries.length === 0) {
      return this.getGenesisHash();
    }
    const latest = this.entries[this.entries.length - 1];
    if (!latest) throw new Error("LEDGER_EMPTY");
    return latest.hash;
  }

  /**
   * Append a new event to the ledger (thread-safe)
   */
  async append(
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<LedgerEntry> {
    await this.lock.acquire();

    try {
      const id = sha256(`${Date.now()}-${Math.random()}`).slice(0, 16);
      const timestamp = Date.now();
      const previousHash = this.getLatestHash();
      this.versionCounter++;

      const entryData = {
        id,
        timestamp,
        eventType,
        payload,
        previousHash,
        version: this.versionCounter,
      };

      const hash = sha256(canonicalJson(entryData));

      const entry: LedgerEntry = deepFreeze({
        ...entryData,
        hash,
      });

      this.entries = deepFreeze([...this.entries, entry]);

      return entry;
    } finally {
      this.lock.release();
    }
  }

  /**
   * Get all entries (read-only copy)
   */
  getEntries(): ReadonlyArray<LedgerEntry> {
    return [...this.entries] as ReadonlyArray<LedgerEntry>;
  }

  /**
   * Verify the integrity of the entire chain
   */
  verifyIntegrity(): boolean {
    let expectedPreviousHash = this.getGenesisHash();

    for (const entry of this.entries) {
      if (entry.previousHash !== expectedPreviousHash) {
        return false;
      }

      const entryData = {
        id: entry.id,
        timestamp: entry.timestamp,
        eventType: entry.eventType,
        payload: entry.payload,
        previousHash: entry.previousHash,
        version: entry.version,
      };

      const computedHash = sha256(canonicalJson(entryData));
      if (computedHash !== entry.hash) {
        return false;
      }

      expectedPreviousHash = entry.hash;
    }

    return true;
  }

  /**
   * Get the current chain length
   */
  getLength(): number {
    return this.entries.length;
  }

  /**
   * Get entries by event type
   */
  getByEventType(eventType: string): ReadonlyArray<LedgerEntry> {
    return this.entries.filter(e => e.eventType === eventType);
  }
}

// Export singleton instance for shared usage
export const ledger = new ImmutableLedger();
