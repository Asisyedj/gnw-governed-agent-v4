#!/bin/sh
set -eu
: "${GNW_APP_DB_USER:?GNW_APP_DB_USER is required}"
: "${GNW_APP_DB_PASSWORD:?GNW_APP_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$GNW_APP_DB_USER" -v app_password="$GNW_APP_DB_PASSWORD" <<'SQL'
-- Dedicated, non-login owner for global audit-chain verification.
-- NOBYPASSRLS is required; global visibility comes from a scoped SELECT policy; do not grant it to
-- the application role or any ordinary runtime identity.
SELECT 'CREATE ROLE gnw_audit_verifier NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gnw_audit_verifier') \gexec

-- Migration may temporarily transfer the verifier function to this NOLOGIN role.
-- The release/migration administrator must revoke CREATE after all migrations.
GRANT USAGE, CREATE ON SCHEMA public TO gnw_audit_verifier;

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_user', :'app_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format(
  'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
  current_database(), :'app_user'
) \gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec

-- Default privileges for tables and sequences created by the schema owner (postgres or migrator)
SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'app_user'
) \gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'app_user'
) \gexec

-- Base table and sequence grants if tables already exist
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'app_user'
) \gexec

SELECT format(
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'app_user'
) \gexec

-- STRICT LEAST-PRIVILEGE REVOCATIONS on append-only and control tables:
-- 1. audit_log: append-only; strictly revoke UPDATE, DELETE, TRUNCATE
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_log') THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM %I', :'app_user');
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.audit_log TO %I', :'app_user');
  END IF;
END $$;

-- 2. audit_chain_head: singleton tip; strictly revoke INSERT, UPDATE, DELETE, TRUNCATE (managed by trigger)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_chain_head') THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.audit_chain_head FROM %I', :'app_user');
    EXECUTE format('GRANT SELECT ON TABLE public.audit_chain_head TO %I', :'app_user');
  END IF;
END $$;

-- 3. gnw_migrations: ledger table; strictly revoke INSERT, UPDATE, DELETE, TRUNCATE from app role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gnw_migrations') THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.gnw_migrations FROM %I', :'app_user');
    EXECUTE format('GRANT SELECT ON TABLE public.gnw_migrations TO %I', :'app_user');
  END IF;
END $$;
SQL
