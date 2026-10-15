# Production Anomaly Response and Safe Recovery Runbooks

**Status: PROPOSED — documentation only; not a production control or certification.**

## Safety contract

This document defines an implementation and validation contract. It does not enable automatic production rollback, alter deployment policy, or claim that live monitoring exists. Runtime automation must remain disabled until a separate reviewed implementation passes the required gates below.

### Decision states

- **PASS:** all required, fresh, authenticated signals are present and within approved bounds.
- **HOLD:** telemetry is missing/stale, confidence is insufficient, a provider is unavailable, or evidence cannot be verified. Stop new risky actions; alert the on-call operator.
- **DENY:** a confirmed security/audit integrity violation, unauthorized action, or critical invariant breach. Fail closed, revoke the affected execution lease where supported, stop affected work, preserve evidence, and page the incident owner.

No model-generated risk score may override deterministic policy gates. A language model may summarize evidence and suggest a runbook; it must not grant permissions, disable interlocks, suppress alerts, or authorize its own remediation.

## Signal collection and threat estimation

For every signal, record: source/provider, tenant and environment, observed-at timestamp, freshness limit, correlation/request ID, normalized severity, evidence reference/digest, detector version, and disposition. Sanitize sensitive fields before storage and output.

Monitor at minimum:
- service health, latency, error rate, saturation, restart loops and dependency availability;
- deployment/image digest, configuration drift and failed health checks;
- authentication failures, privilege changes, grant/lease mismatch, nonce replay and interlock state;
- audit write failures, hash-chain/root verification failures and missing sequence numbers;
- database migration status, RLS/tenant-boundary violations and backup/restore evidence;
- outbound egress policy violations, secret exposure indicators and supply-chain verification failures.

Threat estimation should combine deterministic thresholds, rate-of-change, baselines and corroborating signals. Model-based anomaly scores are advisory until calibrated against labelled data, false-positive/false-negative rates, drift, adversarial inputs and a human-approved threshold. Unknown or stale telemetry must never be treated as healthy.

## Rollback eligibility contract

Automatic rollback is allowed only for a pre-approved, reversible deployment/configuration change with:
1. a known-good, immutable previous artifact digest and verified provenance/signature;
2. an explicit environment/service allowlist and bounded rollback scope;
3. a tested compatibility check for database/schema and data formats;
4. a successful pre-rollback snapshot or recovery point where applicable;
5. a non-replayed, time-bounded capability/lease tied to the exact rollback action;
6. healthy control-plane, audit sink, and independent verification signals;
7. rate limits, retry bounds, cooldown and a maximum number of automated attempts;
8. post-rollback health checks and evidence capture.

Never automatically roll back destructive or irreversible data migrations, rotate/revoke trust anchors, change IAM/RBAC/RLS, weaken egress/sandbox controls, disable the kill switch, change audit integrity controls, alter signing keys/secrets, or modify branch protections. These require a separate approved incident procedure and human operator.

If eligibility cannot be proven, transition to HOLD/DENY as appropriate, stop further rollout, page the operator, and preserve evidence. Do not repeatedly retry a failing rollback.

## Runbook: production anomaly

1. **Detect:** correlate independent signals; reject stale, unauthenticated or malformed telemetry.
2. **Classify:** deterministic policy classifies PASS/HOLD/DENY; model output is advisory only.
3. **Contain:** stop rollout/new risky tasks; preserve kill-switch authority and tenant boundaries.
4. **Choose recovery:** select only a signed, versioned, pre-approved runbook matching environment, artifact digest and anomaly class.
5. **Authorize:** validate the exact action, actor, scope, expiry, nonce and interlock generation. Human approval remains mandatory for high-impact or irreversible actions.
6. **Execute:** use a restricted executor with least privilege, bounded timeout/retries, idempotency key and no general-purpose shell access.
7. **Verify:** check service health, error/latency recovery, dependency state, data integrity and audit-chain continuity.
8. **Stop safely:** if any check is unknown/fails, stop further automation, transition to HOLD/DENY, and page the incident owner.
9. **Record:** append detector inputs, policy decision, runbook version, action digest, approvals, executor result and postcondition evidence to durable tamper-evident audit storage.
10. **Review:** require human incident closure, root-cause analysis and follow-up tasks. Do not let the agent close its own security incident.

## Required test matrix before enabling automation

- Missing, stale, conflicting and forged telemetry => HOLD/DENY; never PASS by default.
- Confirmed audit sink failure/hash-chain mismatch => fail closed and alert.
- False-positive anomaly and noisy dependency => no unsafe rollback loop.
- Valid rollback => exact previous digest only; postconditions must pass.
- Schema/data incompatibility => block automatic rollback.
- Replayed, expired, wrong-tenant or wrong-action lease => reject.
- Kill switch active => executor refuses action.
- Audit unavailable during recovery => no unlogged privileged action.
- Partial rollback/timeout/restart loop => bounded retries, then HOLD and page operator.
- Prompt injection in logs/runbooks/provider responses => treated as untrusted data, never as policy.
- Secrets in findings/logs => redaction verified with adversarial test cases.
- Recovery drill in disposable staging, followed by real staging evidence before any production enablement.

## Release gates

Before enabling any production automation, require all of the following for the exact candidate commit and image digest:
- passing CI, security scans, dependency/SBOM/provenance and signature verification;
- threat model and code review by a reviewer independent from the author/release owner;
- live integration tests and end-to-end mission evidence;
- tested staging anomaly and rollback drills, including failure injection;
- approved monitoring thresholds and documented false-positive/false-negative evaluation;
- operator-owned incident runbooks, paging, recovery objectives, backup/restore proof and kill-switch drill;
- a human operator's explicit, recorded release decision.

Any required gate that is FAIL => DENY. Any BLOCKED/NOT_TESTED/missing evidence => HOLD. A green CI run alone does not certify production readiness.

## Current implementation boundary

The Phase A self-monitoring evaluator is read-only and produces recommendations; it does not itself collect live telemetry, run continuously, execute rollback, or enforce production decisions. This document is a proposed runbook contract only. Production certification remains NOT CERTIFIED until repository certification gates are satisfied.
