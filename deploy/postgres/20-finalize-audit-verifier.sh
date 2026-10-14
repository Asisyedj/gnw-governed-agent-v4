#!/bin/sh
set -eu

: "${PGHOST:?PGHOST must point at the target PostgreSQL instance}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER must be a database administrator authorized to manage roles}"
: "${PGDATABASE:?PGDATABASE is required}"

# Run as a controlled database administrator only after all migrations finish.
# The verifier role is NOLOGIN/NOBYPASSRLS. It can read the global audit log
# solely through its explicit SELECT policy; it is not an application identity.
psql -v ON_ERROR_STOP=1 --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" --dbname "$PGDATABASE" <<'SQL'
ALTER ROLE gnw_audit_verifier NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
REVOKE CREATE ON SCHEMA public FROM gnw_audit_verifier;
REVOKE gnw_audit_verifier FROM gnw_migrator;
REVOKE ALL ON FUNCTION public.gnw_verify_audit_chain() FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gnw_audit_verifier;
GRANT SELECT ON TABLE public.audit_log, public.audit_chain_head TO gnw_audit_verifier;

DO $$
DECLARE
  verifier_oid OID;
  migrator_oid OID;
  function_owner OID;
BEGIN
  SELECT oid INTO verifier_oid FROM pg_catalog.pg_roles WHERE rolname = 'gnw_audit_verifier';
  SELECT oid INTO migrator_oid FROM pg_catalog.pg_roles WHERE rolname = 'gnw_migrator';
  SELECT proowner INTO function_owner FROM pg_catalog.pg_proc
    WHERE oid = pg_catalog.to_regprocedure('public.gnw_verify_audit_chain()');

  IF verifier_oid IS NULL OR migrator_oid IS NULL OR function_owner IS DISTINCT FROM verifier_oid THEN
    RAISE EXCEPTION 'Audit verifier role/function ownership is not in the expected state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid = verifier_oid
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Audit verifier must be NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE';
  END IF;

  IF pg_catalog.has_schema_privilege('gnw_audit_verifier', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Audit verifier still has CREATE on public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = verifier_oid AND member = migrator_oid
  ) THEN
    RAISE EXCEPTION 'Migration role still has audit verifier membership';
  END IF;

  IF NOT pg_catalog.has_table_privilege('gnw_app', 'public.audit_log', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('gnw_app', 'public.audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'Runtime role must retain INSERT/SELECT on audit_log';
  END IF;

  IF pg_catalog.has_table_privilege('gnw_app', 'public.audit_log', 'UPDATE')
     OR pg_catalog.has_table_privilege('gnw_app', 'public.audit_log', 'DELETE')
     OR pg_catalog.has_table_privilege('gnw_app', 'public.audit_log', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Runtime role must not have UPDATE/DELETE/TRUNCATE on audit_log';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'gnw_audit_verifier_global_read'
      AND cmd = 'SELECT'
      AND 'gnw_audit_verifier' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Global audit verifier SELECT policy is missing';
  END IF;
END $$;

SELECT
  'audit verifier finalized' AS status,
  current_database() AS database,
  pg_catalog.pg_get_userbyid(p.proowner) AS function_owner
FROM pg_catalog.pg_proc p
WHERE p.oid = pg_catalog.to_regprocedure('public.gnw_verify_audit_chain()');
SQL
