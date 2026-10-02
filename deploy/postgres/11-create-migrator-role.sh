#!/bin/sh
set -eu
: "${GNW_MIGRATOR_DB_USER:?GNW_MIGRATOR_DB_USER is required}"
: "${GNW_MIGRATOR_DB_PASSWORD:?GNW_MIGRATOR_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   -v migrator_user="$GNW_MIGRATOR_DB_USER" -v migrator_password="$GNW_MIGRATOR_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS CREATEDB NOCREATEROLE NOINHERIT',
  :'migrator_user', :'migrator_password'
) gexec
SELECT format(
  'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
  current_database(), :'migrator_user'
) gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migrator_user') gexec
SQL
