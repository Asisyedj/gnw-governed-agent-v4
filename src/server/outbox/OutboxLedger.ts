/**
 * GNW Outbox Ledger - Asynchronous Outbox Pattern Implementation
 * fix(db): Transactional outbox with FOR UPDATE SKIP LOCKED for race condition elimination
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, text, timestamp, jsonb, boolean, integer, index } from 'drizzle-orm/pg-core';
import { Pool, PoolClient } from 'pg';

/**
 * Outbox table schema
 */
export const outboxTable = pgTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // pending, processing, completed, failed
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lockedAt: timestamp('locked_at'),
    lockedBy: text('locked_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    error: text('error'),
  },
  (table) => ({
    statusIdx: index('outbox_status_idx').on(table.status),
    createdAtIdx: index('outbox_created_at_idx').on(table.createdAt),
  })
);

/**
 * Outbox event interface
 */
export interface OutboxEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

/**
 * Generate UUID v4
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Outbox Ledger class with transactional boundaries
 */
export class OutboxLedger {
  private pool: Pool;
  private workerId: string;

  constructor(pool: Pool, workerId?: string) {
    this.pool = pool;
    this.workerId = workerId || generateUuid();
  }

  /**
   * Append event to outbox within transaction
   */
  async append(
    client: PoolClient,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<OutboxEvent> {
    const id = generateUuid();
    const now = new Date();

    const result = await client.query<OutboxEvent>(
      `
      INSERT INTO outbox_events (
        id, event_type, payload, status, attempts, max_attempts,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        id,
        eventType,
        JSON.stringify(payload),
        'pending',
        0,
        3,
        now,
        now,
      ]
    );

    return result.rows[0];
  }

  /**
   * Lock and fetch next pending events using FOR UPDATE SKIP LOCKED
   * This eliminates race conditions in multi-worker scenarios
   */
  async lockNext(batchSize: number = 10): Promise<OutboxEvent[]> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query<OutboxEvent>(
        `
        SELECT *
        FROM outbox_events
        WHERE status = 'pending'
          AND attempts < max_attempts
          AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        `,
        [batchSize]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return [];
      }

      // Lock the rows
      await client.query(
        `
        UPDATE outbox_events
        SET locked_at = NOW(),
            locked_by = $1,
            status = 'processing',
            updated_at = NOW()
        WHERE id = ANY($2)
        `,
        [this.workerId, result.rows.map((r) => r.id)]
      );

      await client.query('COMMIT');

      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark event as completed
   */
  async complete(eventId: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query(
        `
        UPDATE outbox_events
        SET status = 'completed',
            completed_at = NOW(),
            updated_at = NOW(),
            locked_at = NULL,
            locked_by = NULL
        WHERE id = $1
        `,
        [eventId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Mark event as failed with retry logic
   */
  async fail(eventId: string, error: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query(
        `
        UPDATE outbox_events
        SET status = CASE
          WHEN attempts + 1 >= max_attempts THEN 'failed'
          ELSE 'pending'
        END,
        attempts = attempts + 1,
        error = $2,
        updated_at = NOW(),
        locked_at = NULL,
        locked_by = NULL
        WHERE id = $1
        `,
        [eventId, error]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Release stale locks (cleanup job)
   */
  async releaseStaleLocks(): Promise<number> {
    const result = await this.pool.query(
      `
      UPDATE outbox_events
      SET locked_at = NULL,
          locked_by = NULL,
          status = 'pending',
          updated_at = NOW()
      WHERE status = 'processing'
        AND locked_at < NOW() - INTERVAL '5 minutes'
      `
    );

    return result.rowCount || 0;
  }

  /**
   * Get pending events count
   */
  async getPendingCount(): Promise<number> {
    const result = await this.pool.query<{
      count: string;
    }>(
      `
      SELECT COUNT(*)::text as count
      FROM outbox_events
      WHERE status = 'pending'
      `
    );

    return parseInt(result.rows[0].count, 10);
  }
}

/**
 * SQL Migration script
 */
export const migrationSql = `
-- Create outbox_events table
CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMP,
  locked_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox_events (status);
CREATE INDEX IF NOT EXISTS outbox_created_at_idx ON outbox_events (created_at);
CREATE INDEX IF NOT EXISTS outbox_status_created_idx ON outbox_events (status, created_at);

-- Add constraint for valid status
ALTER TABLE outbox_events
ADD CONSTRAINT check_status
CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
`;

export default OutboxLedger;
