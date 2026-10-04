# GNW Final Verification — 2026-10-04

## Release state

- Repository: `GNW-production-audit`
- Final commit: `fedd7d5ada9610842931eaf551876da5962dc1dc`
- Working tree: clean after release cleanup
- Production client build: PASS (`dist/client/index.html` present)
- Production server build: PASS (`dist/server/server/app.js` present)
- Static production closure gate: PASS

## Governance tests

The governance suite previously completed with:

- 12 test files passed
- 45 tests passed
- 0 failures

The suite covered governance contract, justice framework, golden evaluations, adversarial governance, decision schema, logging/error/pagination units, and the agent-pipeline integration suite.

## Database / RLS runtime verification

A local PostgreSQL 16.15 runtime was brought up on `127.0.0.1:55432` for the integration gate.

Applied migrations:

1. `0000_initial.sql`
2. `0001_production_rls.sql`
3. `0002_governance_hardening.sql`
4. `0003_governance_evidence.sql`
5. `0004_interlock_reason.sql`

The migration runner is checksum-backed, transactional, advisory-lock protected, and idempotent.

RLS runtime evidence:

- 12 public tables have RLS enabled and forced.
- Tenant policies use `current_setting('app.tenant_id', true)`.
- Tenant 1 sees only its own user row.
- Tenant 2 sees only its own user row.
- Tenant 1 cross-tenant visibility query returned `0` rows.

A schema/runtime mismatch was found and repaired during verification: `interlocks.reason` existed in the application schema but not in the SQL migrations. Migration `0004_interlock_reason.sql` closes that gap.

A migration ordering defect was also repaired: `capability_leases` is now created before the column alteration that references it.

## Live production-mode verification

The compiled server was run in `NODE_ENV=production` against the local PostgreSQL runtime.

Verified endpoints:

- `GET /api/health` → HTTP 200
- `GET /api/ready` → HTTP 200 with `killSwitch=false`, `circuitOpen=false`, `generation=0`
- `GET /` → HTTP 200 serving the compiled client

Authenticated API smoke test:

- bootstrap → HTTP 200
- registration → HTTP 201
- `/api/me` → HTTP 200
- `/api/governance/contract` → HTTP 200

The governance contract response exposed the governed role/capability model to the authenticated UI.

## Graphical/browser verification

`agent-browser` was installed and run against the compiled production server using the installed Microsoft Edge executable.

Browser checks:

- Page navigation succeeded.
- `document.body.innerText` was non-empty.
- No framework error overlay was detected.
- Accessibility snapshot showed the GNW sign-in UI with Email, Password, and Sign in controls.
- Static HTML loaded the compiled JS/CSS assets successfully.

## Runtime fixes made during closure

- Fixed Windows ESM entrypoint detection in the migration runner.
- Fixed Windows ESM entrypoint detection in the production server.
- Corrected the production server start path to `dist/server/server/app.js`.
- Corrected the compiled-client static root from `../../dist/client` to `../../../dist/client`.
- Added the missing `interlocks.reason` migration.
- Corrected capability-lease migration ordering.
- Repaired the production closure script's missing filesystem imports.
- Added transient-artifact exclusion to `.gitignore`.

## Final conclusion

GNW is now **code-verified, database/RLS-runtime-verified, production-build-verified, live-endpoint-verified, and browser-verified** on the authorized test host.

The local PostgreSQL runtime used for verification was stopped and its transient data directory was removed after testing. No runtime database state or test secrets are included in the repository.