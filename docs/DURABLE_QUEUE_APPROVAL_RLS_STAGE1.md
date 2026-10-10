# GNW Durable Queue + Governance + Tenant RLS

Branch: `fix/durable-queue-approval-rls-2026-10-10`
Base: `main` at `35801bc8f97286bec2a168122c766a8403befd19`

## Implemented on this branch

- PostgreSQL durable job queue with atomic `FOR UPDATE SKIP LOCKED` claims, per-claim lease tokens, heartbeats, expired-lease recovery, idempotency keys, cancel requests, and cancellation acknowledgements.
- New tenant-scoped queue API at `POST /api/tasks/:id/execute/queued`; it validates the same task/actor/grant/envelope bindings as synchronous execution and returns `202` after durable enqueue.
- Separate worker entrypoint: `npm run worker`, configured with explicit `GNW_WORKER_TENANT_IDS`. Workers claim only `governed_tool_execution` jobs and re-enter `executeWithGovernance` before calling the governed executor. Governed queue entries use one attempt: an uncertain result must not cause automatic replay of a one-time grant.
- Existing GNW exact-digest approvals are reused. The queued route checks the approved row against the current `digestRequest(grant)`, tenant, request ID and expiry; the worker checks it again. The final authorization remains the current `GovernanceService`, which re-computes the request digest and claims the approval/grant nonces to reject replay. No parallel approval table is used.
- Durable cancellation endpoint at `POST /api/tasks/:id/execute/jobs/:jobId/cancel`; cancellation remains pending until the worker observes it, cancels the executor, and records the acknowledgement. Pending jobs that have not been claimed can be marked cancelled immediately.
- Authenticated executor cancellation client uses `POST <EXECUTOR_URL>/cancel` and requires `{ cancelled: true, requestId }` as confirmation. The companion isolated executor must implement an idempotent request-ID cancellation fence, terminate and confirm the process tree, and reject execution whose request ID was cancelled first. If confirmation is absent, the worker does not report a confirmed cancellation; lease recovery records `CANCEL_UNCONFIRMED`.
- New workflow/job tables use integer tenant IDs to match `tenants.id`, enable and force RLS, set tenant context transaction-locally, and bind workflow references to the same tenant through composite foreign keys.
- PostgreSQL CI verification covers cross-tenant read/write/update/delete isolation, missing tenant context, enforced RLS, cross-tenant workflow-reference rejection, idempotent enqueue, two concurrent worker claims, heartbeat, lease recovery and durable cancellation acknowledgement.
- Ledger append/read APIs now snapshot and deep-freeze internal event data and return defensive clones, addressing mutation of historical ledger events.
- Dependency security override uses `shell-quote@1.12.0` rather than the affected `1.8.4–1.10.0` range.

## Operational requirements before release

1. Deploy the worker as a separate process with a non-owner PostgreSQL role that has neither superuser nor `BYPASSRLS`; set `GNW_WORKER_TENANT_IDS` to the tenant IDs that process is allowed to service.
2. The companion executor service must implement and integration-test the authenticated `/cancel` contract. This repository contains the cancellation client, not that external executor service. Until an executor integration run proves that the child process tree stops and the request-ID fence blocks a dispatch/cancel race, real remote process cancellation remains **BLOCKED / UNPROVEN**.
3. Browser context closure is available through `ExecutionCancellation.registerBrowserContext`, but this branch has no active browser-executor call site to register. Browser-specific cancellation remains **BLOCKED / UNPROVEN** until such a call site is integrated and tested.
4. CI PostgreSQL 16.15 is a production-equivalent schema/RLS test, not the actual production database. No production DB was modified or verified in this branch. Run the migration and the same verification script against an explicitly authorized staging-equivalent database using TLS before any release.
5. The PR remains review-only. Merge/deploy only after fresh typecheck, lint, complete test/coverage, build, CI Postgres queue/RLS tests, security gates and executor-side cancellation evidence all pass on the same commit.

## Commands

```sh
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run verify:rls
npm run verify:queue-rls
npm audit --audit-level=high
```

The `verify:queue-rls` check is wired into both CI and continuous security after migrations and runtime-role setup. Passing this gate does not substitute for actual production or remote-executor verification.
