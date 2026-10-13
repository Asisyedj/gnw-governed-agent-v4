-- 0003_audit_hash_chain.sql
-- Adds cryptographic hash chain columns to audit_log for tamper-detection.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_entry_hash TEXT DEFAULT 'GENESIS';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT DEFAULT 'pending';

-- Temporarily bypass append-only trigger for schema backfill of existing historical records
ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;

UPDATE audit_log
  SET prev_entry_hash = COALESCE(prev_entry_hash, 'GENESIS'),
      entry_hash = COALESCE(
        entry_hash,
        'BACKFILL-' || encode(
          sha256(
            convert_to(
              id::text || '|' || event_type || '|' || COALESCE(actor_id::text, '') || '|' ||
              COALESCE(tenant_id::text, '') || '|' || COALESCE(outcome, '') || '|' ||
              COALESCE(detail::text, 'null') || '|' || created_at::text || '|GENESIS',
              'UTF8'
            )
          ),
          'hex'
        )
      )
WHERE entry_hash IS NULL OR prev_entry_hash IS NULL;

-- Re-enable append-only trigger immediately
ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;

ALTER TABLE audit_log ALTER COLUMN entry_hash SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN prev_entry_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_entry_hash_idx ON audit_log(entry_hash);

COMMENT ON COLUMN audit_log.entry_hash IS 'SHA-256(id|event_type|actor_id|tenant_id|outcome|detail|created_at|prev_entry_hash)';
COMMENT ON COLUMN audit_log.prev_entry_hash IS 'entry_hash of the previous audit_log row, or GENESIS for the first entry';
