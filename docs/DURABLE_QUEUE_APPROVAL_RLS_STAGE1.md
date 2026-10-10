# GNW Durable Queue + Approval + RLS implementation branch

Branch: `fix/durable-queue-approval-rls-2026-10-10`
Base: `main` at `35801bc8f97286bec2a168122c766a8403befd19`

## Included
- PostgreSQL durable queue with atomic `FOR UPDATE SKIP LOCKED` lease claims, lease tokens, heartbeat, retry, cancellation request and acknowledgement.
- Canonical JSON + SHA-256 action digest, actor/tenant/target/action binding and atomic one-time approval consumption.
- Tenant-owned workflow/job/approval tables using INTEGER tenant IDs to match `tenants.id`.
- RLS ENABLE + FORCE and transaction-local `app.tenant_id` policy on new tables.
- Unit tests for digest stability and binding.

## Important integration limits
This branch introduces the durable primitives but does not silently claim that the app's existing task routes, worker runtime, browser process supervisor or current approval route have been rewired. Those integrations require a worker entrypoint and application-level action call sites. A DB cancellation record alone cannot kill a process; the worker must observe it and terminate the child process/browser context, then acknowledge cancellation.

## Apply and verify
1. Review migration against the exact staging schema.
2. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
3. Run `DATABASE_URL=<staging>` with TLS as configured, then `npm run db:migrate` and `npm run verify:rls`.
4. Add/execute PostgreSQL integration tests with at least two tenants and two workers; do not treat unit tests as RLS or process-kill proof.
5. Wire worker heartbeat/cancel poll into actual executor, and wire `consumeActionApproval` immediately before each sensitive side effect in the governance path.
6. No production DB mutation or deploy is included in this change.
