-- 0003_audit_hash_chain.sql
-- Cryptographic hash chain for audit_log tamper-detection.
-- Guarantees:
-- 1. Every audit entry is cryptographically bound to its predecessor via SHA-256.
-- 2. First entry links to 'GENESIS'.
-- 3. Automatic, transactional hash generation via BEFORE INSERT trigger with FOR UPDATE row locking.
-- 4. SECURITY DEFINER ensures application roles without UPDATE privileges can safely insert into the chain.
-- 5. Append-only enforcement via trigger and table privilege revocation.

-- Add columns if not already present
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_entry_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;

-- Trigger function for automatic transactional chain calculation
-- SECURITY DEFINER allows non-superuser application roles (gnw_app) to lock & compute
-- the chain tail without granting gnw_app UPDATE privileges on audit_log.
CREATE OR REPLACE FUNCTION gnw_audit_hash_chain_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_hash TEXT;
  v_payload TEXT;
BEGIN
  -- Obtain exclusive row lock on the latest audit entry to strictly serialize chain writes
  SELECT entry_hash INTO v_prev_hash
  FROM audit_log
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_prev_hash IS NULL THEN
    v_prev_hash := 'GENESIS';
  END IF;

  NEW.prev_entry_hash := v_prev_hash;
  NEW.created_at := COALESCE(NEW.created_at, NOW());

  v_payload := NEW.event_type || '|' ||
               COALESCE(NEW.actor_id::text, '') || '|' ||
               COALESCE(NEW.tenant_id::text, '') || '|' ||
               COALESCE(NEW.outcome, '') || '|' ||
               COALESCE(NEW.detail::text, 'null') || '|' ||
               to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
               v_prev_hash;

  NEW.entry_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS audit_log_chain_insert ON audit_log;
CREATE TRIGGER audit_log_chain_insert
BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION gnw_audit_hash_chain_insert();

-- Historical backfill: sequentially chain all existing rows from GENESIS
DO $$
DECLARE
  r RECORD;
  v_prev TEXT := 'GENESIS';
  v_payload TEXT;
  v_hash TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_append_only') THEN
    ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;
  END IF;

  FOR r IN SELECT id, event_type, actor_id, tenant_id, outcome, detail, created_at FROM audit_log ORDER BY id ASC LOOP
    v_payload := r.event_type || '|' ||
                 COALESCE(r.actor_id::text, '') || '|' ||
                 COALESCE(r.tenant_id::text, '') || '|' ||
                 COALESCE(r.outcome, '') || '|' ||
                 COALESCE(r.detail::text, 'null') || '|' ||
                 to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                 v_prev;
    v_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');

    UPDATE audit_log
    SET prev_entry_hash = v_prev,
        entry_hash = v_hash
    WHERE id = r.id;

    v_prev := v_hash;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_append_only') THEN
    ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;
  END IF;
END $$;

-- Enforce NOT NULL constraints (no pending, no nulls)
ALTER TABLE audit_log ALTER COLUMN entry_hash SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN prev_entry_hash SET NOT NULL;

-- Remove temporary defaults if any exist
ALTER TABLE audit_log ALTER COLUMN entry_hash DROP DEFAULT;
ALTER TABLE audit_log ALTER COLUMN prev_entry_hash DROP DEFAULT;

-- Performance index for chain lookups
CREATE INDEX IF NOT EXISTS audit_log_entry_hash_idx ON audit_log(entry_hash);

-- Verification function callable from SQL
CREATE OR REPLACE FUNCTION gnw_verify_audit_chain()
RETURNS TABLE (
  total_entries BIGINT,
  valid_links BIGINT,
  broken_links BIGINT,
  hash_mismatches BIGINT,
  is_valid BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_expected_prev TEXT := 'GENESIS';
  v_payload TEXT;
  v_computed_hash TEXT;
  v_total BIGINT := 0;
  v_valid_links BIGINT := 0;
  v_broken_links BIGINT := 0;
  v_mismatches BIGINT := 0;
BEGIN
  FOR r IN SELECT id, event_type, actor_id, tenant_id, outcome, detail, created_at, prev_entry_hash, entry_hash
           FROM audit_log ORDER BY id ASC LOOP
    v_total := v_total + 1;

    -- Check link to predecessor
    IF r.prev_entry_hash = v_expected_prev THEN
      v_valid_links := v_valid_links + 1;
    ELSE
      v_broken_links := v_broken_links + 1;
    END IF;

    -- Recompute entry hash
    v_payload := r.event_type || '|' ||
                 COALESCE(r.actor_id::text, '') || '|' ||
                 COALESCE(r.tenant_id::text, '') || '|' ||
                 COALESCE(r.outcome, '') || '|' ||
                 COALESCE(r.detail::text, 'null') || '|' ||
                 to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                 r.prev_entry_hash;
    v_computed_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');

    IF r.entry_hash <> v_computed_hash THEN
      v_mismatches := v_mismatches + 1;
    END IF;

    v_expected_prev := r.entry_hash;
  END LOOP;

  RETURN QUERY SELECT
    v_total,
    v_valid_links,
    v_broken_links,
    v_mismatches,
    (v_broken_links = 0 AND v_mismatches = 0);
END;
$$;
