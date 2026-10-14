#!/bin/sh
set -eu
: "${GNW_MIGRATOR_DB_USER:?GNW_MIGRATOR_DB_USER is required}"
: "${GNW_MIGRATOR_DB_PASSWORD:?GNW_MIGRATOR_DB_PASSWORD is required}"

# The shared finalizer and release procedures use this canonical migration role.
[ "$GNW_MIGRATOR_DB_USER" = "gnw_migrator" ] || {
  echo "GNW_MIGRATOR_DB_USER must be gnw_migrator" >&2
  exit 1
}

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_user="$GNW_MIGRATOR_DB_USER" -v migrator_password="$GNW_MIGRATOR_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
  :'migrator_user', :'migrator_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'migrator_user') \gexec

SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT', :'migrator_user') \gexec

SELECT format(
  'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
  current_database(), :'migrator_user'
) \gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migrator_user') \gexec

-- This membership is temporary: migration 0004 transfers the global audit
-- verifier function to this NOLOGIN/NOBYPASSRLS role. Always run
-- deploy/postgres/20-finalize-audit-verifier.sh after the migration batch.
SELECT format('GRANT gnw_audit_verifier TO %I', :'migrator_user')
WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gnw_audit_verifier') \gexec
SQL
