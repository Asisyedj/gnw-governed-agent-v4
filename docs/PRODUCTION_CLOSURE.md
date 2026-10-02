# GNW Production Closure Gate

## Problem
The system can have individual security controls while still being unsafe if authorization, tenant isolation, execution, audit, and release evidence are not enforced as one fail-closed path. The production blocker is therefore **control-path integrity**, not the absence of a single feature.

## Required control path
1. Authenticate the actor and bind tenant, actor, task, request and capability context.
2. Normalize and hash the intended action before execution.
3. Evaluate governance and interlocks before any side effect.
4. Require human approval for classified/high-impact operations and bind approval to the exact action digest, tenant, request and nonce.
5. Reserve budgets before execution and reject replay/expired grants.
6. Execute only through the governed executor/tool path.
7. Persist auditable invocation and result events; security-critical audit failures are fail-closed.
8. Persist trajectory/step hashes and verify the chain and root before completion.
9. Enforce PostgreSQL tenant isolation with `FORCE ROW LEVEL SECURITY` and a transaction-scoped `app.tenant_id`.
10. Release only when static, unit, integration, database/RLS, security and deployment evidence all pass.

## External security alignment
OWASP's 2025 LLM guidance highlights prompt injection, sensitive information disclosure, supply chain, improper output handling, excessive agency and unbounded consumption; its Agentic Top 10 additionally covers agent goal hijack, tool misuse, identity/privilege abuse, agentic supply chain, unexpected code execution, memory/context poisoning, inter-agent communication, cascading failures, human-agent trust exploitation and rogue-agent behavior. GNW controls therefore must be enforced outside the model, at the authorization and execution boundaries.

NIST AI RMF provides the risk-management framework; NIST's GenAI profile provides generative-AI-specific risk actions. The GNW gate treats those as governance evidence requirements rather than as a substitute for runtime controls.

## Release evidence
A production PASS requires all of the following on the same commit:
- `npm ci` succeeds from a committed lockfile.
- typecheck, lint, unit tests and coverage pass.
- PostgreSQL migration succeeds on a clean database.
- cross-tenant RLS tests prove tenant A cannot read/write tenant B rows.
- approval, nonce/replay, interlock, executor-auth and SSRF tests pass.
- build artifacts start successfully in the production container.
- deployment manifests validate and health/readiness checks succeed.
- CI dependency audit is fail-closed for the configured severity threshold.
- evidence records contain commit SHA, timestamps and test/build results.

Until the final runtime evidence exists, the release state remains `DENY/HOLD` rather than being inferred from static inspection.
