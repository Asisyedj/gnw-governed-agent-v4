# GNW Autonomous Governance and Self-Repair Plan

Status: PROPOSED — design/evidence plan only; not a production authorization.
Scope: Add a governed self-observation, diagnosis, repair-proposal, validation, and bounded rollout lifecycle to GNW.

## 1. Objective

GNW may autonomously detect operational/security regressions, create a diagnosis, propose a minimal repair, run isolated validation, and apply only pre-authorized low-risk reversible changes. It must never autonomously weaken its own governance boundary, expand its privileges, disable audit/approval, or promote unverified code to production.

The model is an untrusted decision component. Deterministic policy enforcement, signing keys, deployment permissions, and release authorization remain outside the model.

## 2. Non-negotiable invariants

1. Fail closed when policy, identity, audit persistence, attestation, or required evidence is unavailable.
2. The repair agent has no production deploy credentials, no permission to modify branch protections, no ability to edit its own policy roots, and no ability to sign its own release.
3. Policy engine and repair executor are separate trust domains. The model can propose; deterministic validators decide admissibility.
4. Every proposal binds to an exact repository, base commit SHA, patch digest, test suite, risk tier, and expiration.
5. No self-modification of: authorization checks, RLS/tenant isolation, grant/lease verification, audit-chain code, kill switch/interlocks, secret handling, egress controls, CI required checks, branch protections, or certification rules.
6. All changes are least-privilege, minimal, reversible where practical, and have a tested rollback path.
7. No live destructive action, credential rotation, firewall/egress change, production migration, or release promotion without a separately authorized policy and appropriate human approval.
8. The repair agent cannot mark its own evidence as PASS, certify itself, or approve its own pull request.
9. Prompt-injection content from logs, tickets, repositories, or external tools is data, never authority or executable policy.
10. Emergency stop is controlled outside the repair agent and remains available if the agent or model is compromised.

## 3. Proposed architecture

Telemetry and evidence collectors
  -> deterministic signal normalizer / redaction
  -> anomaly and policy detector
  -> repair planner (model may propose a diagnosis and patch)
  -> risk classifier and immutable policy gate
  -> disposable sandbox (no production secrets; restricted network)
  -> tests, SAST/dependency/secret scans, policy regression tests
  -> signed evidence bundle bound to base SHA + patch digest
  -> pull request / canary candidate
  -> independent CI and reviewer or pre-authorized low-risk auto-apply
  -> health monitoring and automatic rollback
  -> append-only audit evidence

Trust boundaries:
- The model has read-only evidence access and may write proposals to a staging branch.
- A separate runner executes tests; tool output is treated as untrusted.
- A narrowly scoped deployment controller, not the model, performs any allowed apply.
- Signing and release keys are unavailable to the model and test sandbox.

## 4. Risk tiers and permitted autonomy

### Tier 0 — Observe
Examples: summarize alerts, correlate failures, detect dependency advisories, report latency drift.
Autonomy: automatic detection and reporting. No mutation.

### Tier 1 — Reversible, non-security changes
Examples: adjust a non-security performance threshold in a sandbox, improve diagnostics, add tests or documentation.
Autonomy: may open a PR automatically after tests and scans pass. Auto-merge only if repository policy explicitly permits it and all required checks pass.

### Tier 2 — Application behavior or operational configuration
Examples: retry policy changes, worker concurrency, non-destructive service configuration.
Autonomy: prepare patch and staging deployment; require explicit approval before rollout unless a pre-approved, bounded runbook authorizes the exact action. Canary and rollback required.

### Tier 3 — Security boundary or privileged changes
Examples: auth/RBAC, tenant RLS, grants/leases, audit ledger, secrets, egress, kill switch, sandbox policy, CI permissions, branch protection, production migrations.
Autonomy: detect and propose only. No automatic application or approval. Independent security review and explicit release authorization required.

### Tier 4 — Destructive or irreversible actions
Examples: delete production data, disable security controls, rotate/revoke critical credentials without a rehearsed runbook, broad network changes.
Autonomy: prohibited for self-repair. Use a separately authorized incident process with human control.

## 5. Self-repair lifecycle

1. Observe: collect health, error rates, failed policy checks, resource metrics, audit-chain status, and test regressions.
2. Normalize: redact secrets/PII; attach timestamps, source identity, and provenance.
3. Diagnose: produce a hypothesis, confidence, impact, alternatives, and supporting evidence references.
4. Classify: deterministic rules map the proposed action to the highest applicable risk tier.
5. Plan: generate the smallest patch and explicit rollback procedure; do not execute arbitrary shell commands suggested by the model.
6. Validate in isolation: clean checkout, pinned dependencies, no production credentials, restricted egress, resource/time limits.
7. Test: typecheck, lint, unit/integration tests, security regression tests, tenant isolation, audit integrity, secret scan, dependency scan, and relevant performance benchmark.
8. Bind evidence: record base SHA, patch digest, toolchain versions, test outputs, SBOM/provenance as available, and policy decision.
9. Review/apply: PR and independent CI; only Tier 1 or explicitly allowlisted Tier 2 actions may be automatically applied.
10. Canary: staged rollout with explicit SLO and security guardrails.
11. Verify: compare pre/post metrics and run synthetic security checks.
12. Roll back: controller reverts on any guardrail breach; record the trigger and resulting state.
13. Learn safely: update diagnostic heuristics from reviewed outcomes; never let incident data directly rewrite policy or trusted instructions.

## 6. Mandatory gates before any automatic apply

- Base commit and patch digest are immutable and match the tested candidate.
- All required CI and policy regression checks pass.
- No new high/critical dependency or container findings without documented disposition.
- No secret or sensitive data appears in diff, artifacts, logs, or prompt context.
- Change is within an explicit path/operation allowlist and Tier 1 or pre-approved Tier 2.
- Tests and rollback are successful in an isolated environment.
- Audit evidence is durably written and independently verifiable.
- Deployment controller verifies a signed, unexpired authorization for the exact artifact and environment.
- Health and security guardrails remain within limits during canary.
- A kill-switch state, missing evidence, unknown risk, or disagreement between classifiers causes HOLD/DENY.

## 7. Initial implementation plan

Phase A — Read-only observer:
- Define typed RepairFinding, RepairProposal, RiskTier, ValidationEvidence, and RepairDecision schemas.
- Collect health/test/CI/security signals without granting mutation permissions.
- Add redaction and provenance checks.
- Persist findings and decisions in existing durable audit infrastructure.

Phase B — Proposal-only repair:
- Generate patch proposals on an isolated branch.
- Require exact base SHA, diff digest, rationale, test plan, risk tier, and rollback plan.
- Add deterministic protected-path and privilege-expansion checks.
- Open PRs only; no auto-merge or production credentials.

Phase C — Sandboxed validation:
- Run clean install, typecheck, lint, tests, security scans, policy tests, and targeted performance tests.
- Use ephemeral credentials and no production data.
- Save machine-readable evidence tied to candidate SHA and patch digest.

Phase D — Bounded low-risk automation:
- Enable only after successful shadow-mode evaluation and independent review.
- Allowlist exact paths and operations.
- Auto-apply only Tier 1 changes initially; canary and rollback required.
- Keep Tier 2 approval-gated and Tier 3/Tier 4 excluded.

Phase E — Operational assurance:
- Red-team prompt injection and tool-output poisoning.
- Test malicious patch attempts, audit outage, stale approval, replay, sandbox escape attempts, and rollback failure.
- Measure false positives, unsafe proposal rate, repair success, rollback rate, time to detect/repair, and policy violations.
- Reassess autonomy limits after each controlled release.

## 8. Required evidence and success criteria

Each repair attempt must retain:
- Finding ID, severity, source, timestamps, and redacted evidence references.
- Base commit SHA, patch digest, changed paths, and risk classification.
- Policy version and deterministic decision reason.
- Test/scan results with runner identity and tool versions.
- Approval identity where required.
- Artifact digest, deployment/canary observations, and rollback result.
- Final outcome and residual risk.

Initial acceptance criteria:
- 100% of proposals bind to exact base SHA and patch digest.
- 100% of Tier 3/Tier 4 proposals are blocked from autonomous apply.
- 100% of audit/policy-evidence failures result in HOLD/DENY.
- No production credentials are available to the model or sandbox.
- Rollback is demonstrated in staging before any auto-apply is enabled.
- Zero unreviewed changes to protected security paths.
- Shadow mode runs long enough to establish a baseline before activation; duration and thresholds must be approved by the project owner.

## 9. Threats and mitigations

- Prompt injection in logs/issues/docs: treat as untrusted data; strict structured inputs; no instruction authority.
- Malicious repair patch: isolated runner, path allowlists, code scanning, no production secrets, independent CI.
- Self-escalation: external policy gate; immutable protected paths; deployment controller rejects privilege expansion.
- Evidence forgery: bind reports to runner identity, commit and patch digest; sign evidence outside model control.
- Audit outage: fail closed and raise an independent alert.
- Bad repair / regression: canary, SLO/security guardrails, automatic rollback.
- Compromised model/provider: revoke proposal credentials; kill switch outside agent; preserve logs and isolate runner.
- Supply-chain compromise: pinned actions/dependencies where feasible, SBOM, provenance and artifact digest verification.

## 10. Explicit exclusions

This plan does not authorize production deployment, create credentials, change branch protections, run destructive migrations, rotate production secrets, disable security controls, or enable self-modifying production code. Implementation must proceed through a reviewable pull request and the existing production certification gates.

## 11. Decision

Recommended immediate next step: implement Phase A and Phase B in a dedicated feature branch, keeping the system read-only/proposal-only. Do not enable automatic production mutation until evidence from sandboxed validation, adversarial testing, staging rollback, and independent review satisfies the acceptance criteria.
