# GNW Remote Test Evidence — 2026-10-22

## Release decision

**PRODUCTION HOLD — verification incomplete. Do not announce production-ready.** This record intentionally distinguishes successful live connectivity checks from an integration test suite pass.

## Repository/source evidence

- Repository: `Asisyedj/gnw-governed-agent-v4`
- Branch inspected on the Windows remote device: `fix/atomic-nonce-and-postgres-tls-2026-10-22`
- Local Windows checkout HEAD observed: `56d616041629215e281d6b55ba17f1f5a125112f`
- `git status --short --branch` showed multiple untracked files. This means the checkout was not a clean, fully committed reproducible source state.
- `git ls-files src/tests` returned 30 tracked test files.
- `src/tests/integration/` contained 9 test files: `approvals.test.ts`, `auth.test.ts`, `governance-compliance.test.ts`, `health.test.ts`, `interlock.test.ts`, `nonces.test.ts`, `settings.test.ts`, `tasks.test.ts`, and `tool-integration-harness.test.ts`.

## Phone localhost live checks

Observed on the Termux/Ubuntu PRoot deployment:

| Check | Observed result |
|---|---|
| `GET /` | HTTP 200 |
| `GET /api/health` | HTTP 200; JSON status `ok` |
| `GET /api/ready` | HTTP 200; `dependenciesReady: true`, `governedActionsReady: true` at the time of check |
| unauthenticated `GET /api/me` | HTTP 401, expected authentication enforcement |
| PostgreSQL readiness at `127.0.0.1:55432` | `accepting connections` |
| Application DB query | successful; database `gnw_localhost`, role `gnw_app`, server `127.0.0.1`, port `55432` |

These are point-in-time localhost observations, not internet/remote-device availability, a complete security audit, or production certification. The app was bound to `127.0.0.1`.

## Test execution status

- Running `npm test -- --reporter=dot` against the phone's `/opt/gnw/app` deployment bundle exited with code 1 and reported `No test files found`. The deployed bundle contains `dist`, `node_modules`, and `package.json`, but not `src/tests`.
- A Windows remote Vitest run was initiated against the repository checkout. The remote execution tool did not provide a complete final Vitest summary or a trustworthy exit code during this session. Do **not** count this as a pass.
- Consequently, pass/fail/skip totals for the full integration suite are **not verified in this evidence record**. No test assertions or outcomes are fabricated here.

## Required closure before release

1. Re-run the complete test suite from a clean, identified commit using a persistent log and capture the process exit code.
2. Verify database-backed integration tests against an isolated PostgreSQL instance with recorded version, migration state, and sanitized connection configuration.
3. Publish the full Vitest summary and CI status, including every failed test and its resolution; archive the actual logs and artifact hashes.
4. Reconcile the Windows checkout's untracked files and ensure all intended test/evidence changes are committed and pushed.
5. Independently verify production secrets, TLS, deployment configuration, rollback, monitoring, and release evidence. Synthetic/local TEE/MPC artifacts are not genuine hardware-backed attestation or independent MPC verification.
6. Keep the release on hold until these gates are demonstrated with reproducible evidence.

## Scope note

This file records only observations available during the remote verification session. It does not claim all tests passed, does not certify production readiness, and does not contain credentials or secret values.
