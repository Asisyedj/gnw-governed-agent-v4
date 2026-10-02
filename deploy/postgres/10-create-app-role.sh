#!/bin/sh
set -eu
: "${GNW_APP_DB_USER:?GNW_APP_DB_USER is required}"
: "${GNW_APP_DB_PASSWORD:?GNW_APP_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   -v app_user="$GNW_APP_DB_USER" -v app_password="$GNW_APP_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_user', :'app_password'
) gexec
SELECT format(
  'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
  current_database(), :'app_user'
) gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'app_user'
) gexec
SELECT format(
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'app_user'
) gexec
SQL
