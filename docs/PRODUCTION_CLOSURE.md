# GNW Production Closure Gate

## Purpose

The production gate treats control-path integrity as the release criterion. Individual security features are not sufficient if authorization, tenant isolation, execution, audit, and release evidence can be bypassed.

## Required control path

1. Authenticate the actor and bind tenant, actor, task, request and capability context.
2. Normalize and hash the intended action before execution.
3. Evaluate governance and interlocks before every governed side effect.
4. Require human approval for classified/high-impact operations and bind approval to the exact action digest, tenant, request and nonce.
5. Reserve token/byte budgets before execution and reject replay/expired grants.
6. Issue a short-lived capability lease bound to the action and persist its evidence.
7. Execute only through the governed executor/tool path.
8. Persist auditable invocation and result events; required audit failures trip the circuit breaker.
9. Persist trajectory/step hashes and verify the chain and root before task completion.
10. Enforce PostgreSQL tenant isolation with FORCE ROW LEVEL SECURITY and transaction-scoped app.tenant_id.
11. Enforce same-tenant parent/child integrity with composite tenant foreign keys.
12. Keep production model egress behind an HTTPS allowlist, DNS/private-address checks and bounded response sizes.
13. Release only when static, unit, integration, database/RLS, security, supply-chain and deployment evidence all pass.

## Release evidence

A production PASS requires all of the following on the same source commit:

- Clean Git checkout with exact commit SHA and git diff --check.
- npm ci succeeds from the committed lockfile without CI mutation.
- Typecheck, lint, unit tests, integration tests and coverage pass.
- PostgreSQL migration succeeds on a clean database.
- The runtime database role is not superuser and does not bypass RLS.
- Cross-tenant SELECT/INSERT/UPDATE/DELETE tests pass.
- Composite tenant-parent integrity tests pass.
- Approval, nonce/replay, interlock, signed-grant and capability-lease tests pass.
- SSRF and production egress tests pass.
- Executor authentication and sandbox evidence pass.
- Container build starts successfully, vulnerability policy passes, SBOM and provenance are present.
- Kubernetes manifests validate and restricted security posture is enforced.
- Health/readiness checks and controlled smoke tests pass.
- Backup/restore and kill-switch drills produce retained evidence.
- Risk register and compliance evidence are current.
- Any external certification or independent assurance statement is attached to the applicable organizational scope.

## Hard rule

Until the final runtime evidence exists for the exact release SHA, the release state remains DENY/HOLD. Static inspection, screenshots, or a previous audit cannot substitute for current runtime evidence.