-- GNW audit-chain payload framing v2.
-- Existing rows remain hash_version=1 and retain their original hashes.
-- New inserts use version 2 with a domain-separated, UTF-8 byte-length-framed
-- payload. This removes ambiguity caused by concatenating user-controlled
-- fields with a bare "|" delimiter without rewriting historical audit evidence.

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS hash_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.gnw_audit_frame_field(p_value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN '-1:'
    ELSE octet_length(convert_to(p_value, 'UTF8'))::TEXT || ':' || p_value
  END
$$;

CREATE OR REPLACE FUNCTION public.gnw_audit_compute_entry_hash(
  p_hash_version INTEGER,
  p_event_type TEXT,
  p_actor_id INTEGER,
  p_tenant_id INTEGER,
  p_outcome TEXT,
  p_detail JSONB,
  p_created_at TIMESTAMPTZ,
  p_prev_entry_hash TEXT
)
RETURNS TEXT
LANGUAGE PLPGSQL
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_payload TEXT;
BEGIN
  IF p_hash_version = 1 THEN
    -- Compatibility implementation: preserve the exact v1 concatenation used
    -- by migration 0003 for all pre-existing audit rows.
    v_payload := p_event_type || '|' ||
                 COALESCE(p_actor_id::TEXT, '') || '|' ||
                 COALESCE(p_tenant_id::TEXT, '') || '|' ||
                 COALESCE(p_outcome, '') || '|' ||
                 COALESCE(p_detail::TEXT, 'null') || '|' ||
                 to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                 p_prev_entry_hash;
  ELSIF p_hash_version = 2 THEN
    -- Every nullable field has an explicit -1: marker; every non-null field
    -- is prefixed by its UTF-8 byte length. The versioned domain prefix stops
    -- the same bytes from being interpreted as an older hash protocol.
    v_payload := 'GNW.AUDIT.CHAIN.V2' ||
      public.gnw_audit_frame_field(p_event_type) ||
      public.gnw_audit_frame_field(p_actor_id::TEXT) ||
      public.gnw_audit_frame_field(p_tenant_id::TEXT) ||
      public.gnw_audit_frame_field(p_outcome) ||
      public.gnw_audit_frame_field(p_detail::TEXT) ||
      public.gnw_audit_frame_field(to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
      public.gnw_audit_frame_field(p_prev_entry_hash);
  ELSE
    RAISE EXCEPTION 'Unsupported GNW audit hash version: %', p_hash_version;
  END IF;

  RETURN encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
END;
$$;

-- Replace only the insert trigger's implementation; it still serializes chain
-- appends under the transaction-scoped advisory lock and chain-head row lock.
CREATE OR REPLACE FUNCTION public.gnw_audit_hash_chain_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_prev_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('gnw_audit_chain_lock'));

  NEW.id := nextval(pg_get_serial_sequence('public.audit_log', 'id'));

  SELECT last_entry_hash INTO v_prev_hash
  FROM public.audit_chain_head
  WHERE singleton_id = 1
  FOR UPDATE;

  IF v_prev_hash IS NULL THEN
    v_prev_hash := 'GENESIS';
  END IF;

  NEW.prev_entry_hash := v_prev_hash;
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.hash_version := 2;
  NEW.entry_hash := public.gnw_audit_compute_entry_hash(
    NEW.hash_version,
    NEW.event_type,
    NEW.actor_id,
    NEW.tenant_id,
    NEW.outcome,
    NEW.detail,
    NEW.created_at,
    NEW.prev_entry_hash
  );

  UPDATE public.audit_chain_head
  SET last_audit_id = NEW.id,
      last_entry_hash = NEW.entry_hash,
      updated_at = NOW()
  WHERE singleton_id = 1;

  RETURN NEW;
END;
$$;

-- Existing rows retain their v1 hashes. The default becomes v2 for future rows;
-- the BEFORE INSERT trigger explicitly forces version 2 even if a caller tries
-- to submit another hash version.
ALTER TABLE public.audit_log ALTER COLUMN hash_version SET DEFAULT 2;

-- Recreate the global verifier as its dedicated owner. The migration runner
-- temporarily inherits the ability to SET ROLE gnw_audit_verifier; direct CREATE
-- as gnw_migrator would fail because 0004 intentionally transferred ownership.
-- The finalizer revokes the temporary membership and schema CREATE after migration.
SET ROLE gnw_audit_verifier;

-- Recreate the global verifier so it checks v1 history and v2 new entries while
-- retaining the chain-head/empty-ledger checks introduced by migration 0004.
CREATE OR REPLACE FUNCTION public.gnw_verify_audit_chain()
RETURNS TABLE (
  total_entries BIGINT,
  valid_links BIGINT,
  broken_links BIGINT,
  hash_mismatches BIGINT,
  is_valid BOOLEAN
)
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_expected_prev TEXT := 'GENESIS';
  v_computed_hash TEXT;
  v_total BIGINT := 0;
  v_valid_links BIGINT := 0;
  v_broken_links BIGINT := 0;
  v_mismatches BIGINT := 0;
  v_last_id BIGINT;
  v_last_hash TEXT;
  v_head_id BIGINT;
  v_head_hash TEXT;
  v_head_found BOOLEAN;
BEGIN
  FOR r IN
    SELECT id, hash_version, event_type, actor_id, tenant_id, outcome, detail,
           created_at, prev_entry_hash, entry_hash
    FROM public.audit_log
    ORDER BY id ASC
  LOOP
    v_total := v_total + 1;

    IF r.prev_entry_hash IS NOT DISTINCT FROM v_expected_prev THEN
      v_valid_links := v_valid_links + 1;
    ELSE
      v_broken_links := v_broken_links + 1;
    END IF;

    IF r.hash_version NOT IN (1, 2) OR r.hash_version IS NULL THEN
      v_mismatches := v_mismatches + 1;
    ELSE
      v_computed_hash := public.gnw_audit_compute_entry_hash(
        r.hash_version,
        r.event_type,
        r.actor_id,
        r.tenant_id,
        r.outcome,
        r.detail,
        r.created_at,
        r.prev_entry_hash
      );
      IF r.entry_hash IS DISTINCT FROM v_computed_hash THEN
        v_mismatches := v_mismatches + 1;
      END IF;
    END IF;

    v_last_id := r.id;
    v_last_hash := r.entry_hash;
    v_expected_prev := r.entry_hash;
  END LOOP;

  SELECT last_audit_id, last_entry_hash
    INTO v_head_id, v_head_hash
  FROM public.audit_chain_head
  WHERE singleton_id = 1;
  v_head_found := FOUND;

  IF NOT v_head_found THEN
    v_broken_links := v_broken_links + 1;
  ELSIF v_total = 0 THEN
    IF v_head_id IS NOT NULL OR v_head_hash IS DISTINCT FROM 'GENESIS' THEN
      v_broken_links := v_broken_links + 1;
    END IF;
  ELSIF v_head_id IS DISTINCT FROM v_last_id OR v_head_hash IS DISTINCT FROM v_last_hash THEN
    v_broken_links := v_broken_links + 1;
  END IF;

  RETURN QUERY SELECT
    v_total,
    v_valid_links,
    v_broken_links,
    v_mismatches,
    (v_broken_links = 0 AND v_mismatches = 0);
END;
$$;

-- Keep global verification fail-closed while operating as its owner.
REVOKE ALL ON FUNCTION public.gnw_verify_audit_chain() FROM PUBLIC;
RESET ROLE;
