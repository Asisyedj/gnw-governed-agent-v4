# GNW v4 — Authorized Production Certification Plan

**حالت:** Authorized planning only — **NO-GO / HOLD**

**مقصد:** صرف اسی exact source commit، container image digest، اور production environment کے لیے certification eligibility ثابت کرنا جس کے تمام required gates، runtime evidence، trust evidence، اور دو-person approval قابلِ تصدیق ہوں۔ یہ plan خود production deployment، certification، external attestation، یا release publication نہیں کرتا۔

## 1. موجودہ baseline

- Worktree: `/home/ubuntu/gnw-v4-production-readiness`
- Branch: `fix/gnw-v4-production-readiness`
- Base commit: `65f26268c78a62908d04754e523a2029b8d06e1d`
- Current implementation cycle:
  - `shell-quote` pinned to `1.11.0`
  - test-only Vitest environment bootstrap added
  - `npm ci`, typecheck, build, lint, tests, crypto, compliance passed
  - 19 test files / 91 tests passed
- Remaining known blockers:
  - P0-1/P0-8/P0-9 expected Apex/immutable-ledger/outbox/GPU modules and strict ledger suite are absent from the actual HEAD
  - live production PostgreSQL/RLS evidence not yet captured for the exact release
  - real executor sandbox evidence not yet captured
  - TEE/MPC/HSM evidence and independent audit evidence not supplied
  - release image digest remains a placeholder until a real signed image is built
  - production release evidence/seal and two distinct approvals are not yet available

## 2. Certification invariant

> Missing, stale, invalid, simulated, or unbound evidence means `DENY → SAFE STOP → AUDIT`.

Certification must not infer readiness from:

- local tests alone;
- static `verify:production` output alone;
- screenshots or filenames without cryptographic binding;
- demo/generated keys;
- simulated TEE/HSM/MPC evidence;
- a mutable container tag;
- a previous release or previous audit;
- a clean branch that is not the exact release commit.

## 3. Required execution phases

### Phase A — Change control and source identity

**Actions**

1. Freeze the intended release scope and record the exact branch, commit, repository remote, ZIP SHA-256, and manifest SHA-256.
2. Ensure the certification worktree is clean before release preparation.
3. Review every diff; do not include unrelated worktree changes.
4. Create a release candidate tag only after all code changes and tests are complete.

**Pass evidence**

- exact 40-character commit SHA;
- clean `git status --porcelain`;
- passing `git diff --check`;
- tag resolves to the tested commit;
- immutable change record under the release SHA.

**Stop conditions**

- dirty tree;
- unresolved missing P0 modules;
- source/artifact mismatch;
- unreviewed generated or unrelated files.

### Phase B — Complete P0 implementation blockers

The actual repository must be reconciled with the stated P0 requirements before certification.

**Required work**

1. Restore/finish the canonical Apex production modules using existing governance, executor, audit, and database contracts; do not create a parallel authorization mechanism.
2. Implement or formally reconcile immutable ledger canonicalization, deep clone/freeze behavior, replay verification, causal/task/mission binding, and strict lifecycle transitions.
3. Implement stale outbox recovery with bounded retry, idempotency, audit events, and fail-closed handling.
4. Implement the GPU-enforcement endpoint only if it is in the approved product scope; otherwise record a reviewed `NOT_APPLICABLE` decision with authority and evidence.
5. Add adversarial tests for mutation, hash collision/key ordering, cross-mission parents, invalid transitions, replay, stale generation, approval binding, and interlock changes.
6. Maintain strict compiler settings; do not disable `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, or other safety checks to make gates green.

**Pass evidence**

- code review against existing contracts;
- unit and integration tests for every new boundary;
- no placeholder/stub implementation in a production path;
- P0-1 through P0-9 matrix rows marked `PASS` only with direct evidence.

### Phase C — Dependency, static, and behavioral gates

Run on the exact candidate commit using Node 22.x and the committed lockfile:

```text
npm ci
npm ls concurrently shell-quote
npm audit --audit-level=high
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run test:coverage
npm run build
npm run verify:crypto
npm run verify:compliance
npm run verify:production
```

**Pass conditions**

- no lockfile mutation;
- zero high/critical dependency findings;
- typecheck/build/tests pass;
- lint has no blocking errors;
- coverage thresholds pass;
- cryptographic and compliance outputs are retained under the exact SHA.

Warnings do not become failures silently; each warning must be dispositioned or removed before certification.

### Phase D — PostgreSQL and RLS evidence

Use a disposable clean PostgreSQL instance, not production.

**Actions**

1. Create separate `migrator` and restricted runtime `app` roles.
2. Run migrations only as migrator.
3. Verify runtime role is not superuser, does not bypass RLS, and lacks role/database creation privileges.
4. Verify `FORCE ROW LEVEL SECURITY` and tenant-scoped transaction context.
5. Run hostile cross-tenant SELECT/INSERT/UPDATE/DELETE tests.
6. Verify composite tenant-parent foreign keys, audit append-only behavior, nonce replay protection, and migration checksum enforcement.
7. Capture database version, migration output, role attributes, SQL results, and test summary.

**Pass evidence**

- clean migration log;
- `verify:rls` PASS;
- role privilege dump;
- cross-tenant denial evidence;
- immutable evidence bundle bound to the release SHA.

**Blockers**

- missing live/disposable PostgreSQL;
- role bypasses RLS;
- tenant context leaks across transactions;
- any cross-tenant mutation or read.

### Phase E — Executor and sandbox boundary

**Actions**

1. Verify external executor source/version and deployment identity.
2. Verify request authentication, action digest, nonce, lease generation, expiry, replay denial, and interlock behavior.
3. Verify filesystem isolation, network namespace/egress restrictions, resource/time limits, process restrictions, secret absence, and cleanup.
4. Test malicious commands, path traversal, metadata access, DNS rebinding/SSRF, cancellation, timeout, and kill-switch behavior.
5. Retain executor logs and independent sandbox evidence.

**Pass condition**

Only governed, authorized, unexpired, exact-digest actions execute; every denied or failed path produces the required audit result and safe stop.

### Phase F — Production secrets and trust anchors

Provision through the approved secret manager only. Never place values in Git, ZIP, logs, chat, or generated artifacts.

Required verified inputs include:

- TLS `verify-full` PostgreSQL URL and restricted runtime role;
- strong cookie/session/executor/grant/lease secrets;
- HTTPS executor URL;
- signed grants and lease key pairs;
- HTTPS LLM base URL and allowlist;
- real hardware-backed TEE evidence with issuer, measurement, nonce, signature, freshness, and exact release subject;
- M-of-N MPC trust-anchor evidence bound to the TEE measurement;
- HSM/key-custody attestation;
- independent audit report with zero blocking findings;
- two distinct release approvals.

Run:

```text
npm run verify:production:env
```

**Pass condition:** preflight passes with current, independently verifiable, release-bound evidence. Simulators, screenshots, demo keys, fabricated JSON, or stale attestations are automatic `DENY`.

### Phase G — Container, SBOM, provenance, and Kubernetes

**Actions**

1. Build the container from the exact clean commit.
2. Scan the image and filesystem according to the approved vulnerability policy.
3. Generate SBOM and signed provenance.
4. Push to the approved registry and record the immutable image digest.
5. Replace `REPLACE_WITH_VERIFIED_RELEASE_DIGEST` only in the reviewed release change; never use a mutable tag-only deployment.
6. Validate Kubernetes schemas, restricted security context, probes, network policy, service account, resource limits, TLS ingress, secrets mounting, and rollback behavior.
7. Run staging canary and rollback drill.

**Pass evidence**

- image digest bound to source SHA;
- SBOM and provenance;
- vulnerability report within policy;
- manifest validation and server-side dry-run;
- canary health/readiness, kill-switch, tenant isolation, egress, alerting, and rollback evidence.

### Phase H — Release evidence and approvals

Generate release evidence only after all previous phases pass.

Required bindings:

- exact Git commit and release tag;
- applicability and control-matrix digests;
- artifact manifest digest;
- real TEE evidence;
- MPC trust anchor;
- regulatory evidence for every applicable control;
- HSM evidence;
- independent audit evidence;
- two distinct approver identities;
- Ed25519 release seal.

Run:

```text
npm run verify:release:evidence
npm run verify:git-release-metadata
```

**Pass condition:** verifier returns `PASS` with no missing, stale, unbound, or simulated evidence.

### Phase I — Final certification decision

A designated security approver and a separate release owner review the complete evidence ledger. The certification record must state:

- exact source SHA and tag;
- exact image digest;
- environment/tenant scope;
- applicable regulatory profile;
- all evidence artifact digests;
- exceptions, if any, and their authorized disposition;
- rollback owner and procedure;
- approval timestamps and identities;
- final decision: `GO`, `HOLD`, or `DENY`.

No single agent or single identity may self-approve both implementation and release authorization.

## 4. Current go/no-go decision

**Current decision: NO-GO / HOLD.**

Reason: P0 production modules/tests and external production evidence are not complete. Local gates are green for the bounded dependency/test-bootstrap cycle, but that is not production certification.

## 5. Required next action

Next implementation cycle should be **P0-1/P0-8/P0-9 reconciliation and ledger contract design** on the authorized branch. Before code is added, the missing-module source of truth must be identified and reconciled with the actual repository HEAD; no implementation should be invented from filenames alone.
