-- GNW audit verifier hardening.
-- A SECURITY DEFINER verifier owned by an ordinary NOBYPASSRLS migration role
-- can see only the rows allowed by FORCE ROW LEVEL SECURITY. That can make an
-- empty/partial view incorrectly report a valid chain. Provision this dedicated
-- NOLOGIN NOBYPASSRLS role via database-admin/IaC before running migrations.
DO $$
DECLARE
  v_can_login BOOLEAN;
  v_is_superuser BOOLEAN;
  v_bypass_rls BOOLEAN;
BEGIN
  SELECT rolcanlogin, rolsuper, rolbypassrls
    INTO v_can_login, v_is_superuser, v_bypass_rls
  FROM pg_catalog.pg_roles
  WHERE rolname = 'gnw_audit_verifier';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Required role gnw_audit_verifier is missing; provision it as NOLOGIN NOSUPERUSER BYPASSRLS before migration';
  END IF;
  IF v_can_login OR v_is_superuser OR v_bypass_rls THEN
    RAISE EXCEPTION 'gnw_audit_verifier must be NOLOGIN, NOSUPERUSER, NOBYPASSRLS';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('gnw_audit_verifier', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'gnw_audit_verifier needs USAGE on schema public; provision it as DBA';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('gnw_audit_verifier', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'gnw_audit_verifier needs temporary CREATE on schema public for function ownership transfer; provision it as DBA and revoke after migration';
  END IF;
END $$;

GRANT SELECT ON TABLE public.audit_log, public.audit_chain_head TO gnw_audit_verifier;
-- A narrowly scoped SELECT policy lets this NOLOGIN/NOBYPASSRLS role verify the
-- global chain while FORCE ROW LEVEL SECURITY remains enabled for every other
-- role. This is safer and portable to managed PostgreSQL services than BYPASSRLS.
DROP POLICY IF EXISTS gnw_audit_verifier_global_read ON public.audit_log;
CREATE POLICY gnw_audit_verifier_global_read
  ON public.audit_log
  FOR SELECT
  TO gnw_audit_verifier
  USING (true);

CREATE OR REPLACE FUNCTION public.gnw_verify_audit_chain()
RETURNS TABLE (
  total_entries BIGINT,
  valid_links BIGINT,
  broken_links BIGINT,
  hash_mismatches BIGINT,
  is_valid BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
  v_last_id BIGINT;
  v_last_hash TEXT;
  v_head_id BIGINT;
  v_head_hash TEXT;
  v_head_found BOOLEAN;
BEGIN
  -- The dedicated NOLOGIN audit role intentionally verifies the global chain
  -- across tenants through its explicit SELECT-only RLS policy.
  FOR r IN
    SELECT id, event_type, actor_id, tenant_id, outcome, detail, created_at,
           prev_entry_hash, entry_hash
    FROM public.audit_log
    ORDER BY id ASC
  LOOP
    v_total := v_total + 1;

    IF r.prev_entry_hash IS NOT DISTINCT FROM v_expected_prev THEN
      v_valid_links := v_valid_links + 1;
    ELSE
      v_broken_links := v_broken_links + 1;
    END IF;

    v_payload := r.event_type || '|' ||
                 COALESCE(r.actor_id::text, '') || '|' ||
                 COALESCE(r.tenant_id::text, '') || '|' ||
                 COALESCE(r.outcome, '') || '|' ||
                 COALESCE(r.detail::text, 'null') || '|' ||
                 to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                 COALESCE(r.prev_entry_hash, '');
    v_computed_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');

    IF r.entry_hash IS DISTINCT FROM v_computed_hash THEN
      v_mismatches := v_mismatches + 1;
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

  -- Validate the persisted tip, not just the rows still visible in the table.
  -- This detects truncation/deletion of the final row and missing head state.
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

-- Keep direct invocation closed by default. A privileged operational identity
-- must receive EXECUTE explicitly from the DBA if it needs to call this function.
REVOKE ALL ON FUNCTION public.gnw_verify_audit_chain() FROM PUBLIC;
ALTER FUNCTION public.gnw_verify_audit_chain() OWNER TO gnw_audit_verifier;
