#!/bin/sh
set -eu
: "${GNW_MIGRATOR_DB_USER:?GNW_MIGRATOR_DB_USER is required}"
: "${GNW_MIGRATOR_DB_PASSWORD:?GNW_MIGRATOR_DB_PASSWORD is required}"
: "${GNW_APP_DB_USER:?GNW_APP_DB_USER is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   -v migrator_user="$GNW_MIGRATOR_DB_USER" -v migrator_password="$GNW_MIGRATOR_DB_PASSWORD" -v app_user="$GNW_APP_DB_USER" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS CREATEDB NOCREATEROLE NOINHERIT',
  :'migrator_user', :'migrator_password'
) gexec
SELECT format(
  'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
  current_database(), :'migrator_user'
) gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migrator_user') gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user') gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'migrator_user', :'app_user') gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'migrator_user', :'app_user') gexec
SQL
