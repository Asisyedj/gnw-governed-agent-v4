# GNW RLS Policy Suite — Runbook

## Local disposable PostgreSQL

Use a throwaway database only. Never run the mutating RLS suite against production data.

```bash
createdb -U postgres gnw_test
psql -U postgres -d gnw_test -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE gnw_app LOGIN PASSWORD 'gnw_app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE gnw_migrator LOGIN PASSWORD 'gnw_migrator_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT, TEMPORARY ON DATABASE gnw_test TO gnw_app, gnw_migrator;
GRANT USAGE ON SCHEMA public TO gnw_app;
GRANT USAGE, CREATE ON SCHEMA public TO gnw_migrator;
SQL
npm ci
export NODE_ENV=test
export GNW_POSTGRES_SSL_REQUIRED=false
export DATABASE_URL='postgresql://gnw_migrator:gnw_migrator_pw@localhost:5432/gnw_test'
npm run db:migrate
psql -U postgres -d gnw_test -v ON_ERROR_STOP=1 -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gnw_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gnw_app; REVOKE UPDATE, DELETE ON audit_log, nonces, interlocks FROM gnw_app;'
export DATABASE_URL='postgresql://gnw_app:gnw_app_pw@localhost:5432/gnw_test'
npm run verify:rls
npm run test:rls:policy-suite
```

## Evidence and scope

The suite writes `rls-policy-suite-results.json` (mode 0600 where supported). A passing RLS suite demonstrates only the checks it actually runs on that database. It does not prove application/API authentication, browser/provider security, live cloud integrations, recovery readiness, or production certification.

## Staging opt-in

Only run against an isolated, approved staging database with an authorized runtime role:

```bash
export GNW_ENVIRONMENT=staging
export GNW_ALLOW_STAGING_RLS_TESTS=true
export GNW_POSTGRES_SSL_REQUIRED=true
export DATABASE_URL='<approved staging runtime-role URL>'
npm run test:rls:policy-suite
```

Do not use administrator credentials for the runtime test role. Record the candidate commit, database/environment identifier, timestamp, test output and artifact digest.
