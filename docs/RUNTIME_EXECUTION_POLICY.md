# GNW Runtime Execution Policy

Policy ID: GNW-REP-1.0
Effective date: 2026-10-03
Evidence schema: GNW.BuildEvidence.v3
Release rule: no runtime PASS is inferred from static inspection alone.

## Operating method

1. Frame — bind claim/decision, stakeholders, scope, deadline condition, and harm boundary to the task context.
2. Decompose — split the request into independent sub-questions and prerequisites.
3. Map evidence — record supporting and contrary evidence, source quality, freshness, permissions, provenance, and exact citations.
4. Generate alternatives — create at least two materially different approaches plus a do-nothing baseline.
5. Attack assumptions — identify the weakest premise and define a falsifying observation.
6. Simulate failure — pre-mortem misuse, tool outage, bad data, cost overrun, privacy breach, and cascading failure.
7. Decide — use explicit criteria and record the decision rationale.
8. Execute safely — stage, observe, compare, recover, and stop when a safety threshold is breached.
9. Learn — perform post-run review and update tests/playbooks rather than relying only on prompt changes.

## Runtime enforcement

The model is not the authorization boundary. Before a governed side effect, GNW must validate identity, tenant, role, task, request ID, operation, agent, tool, scope, action envelope digest, grant validity, replay nonce, approval binding, budget, interlock state, and capability lease.

Required runtime sequence:

envelope validation -> exact-digest binding -> governance -> approval/replay/budget -> capability lease -> required audit -> side effect -> required result audit -> trajectory evidence

A required audit persistence failure is fail-closed and trips the circuit breaker. Capability leases are bound to request, action digest, tenant, task, actor and interlock generation and are atomically consumed before the side effect.

## Current external guidance baseline

- ISO/IEC 27001:2022, Edition 3 (2022-10).
- ISO/IEC 42001:2023, Edition 1 (2023-12).
- NIST AI RMF 1.0 (2023-01); NIST states it is being revised.
- NIST AI RMF Generative AI Profile, NIST AI 600-1 (2024-07-26; NIST page updated 2026-04-08).
- OWASP GenAI LLM Top 10 2026 (2026-08-03).
- OWASP Agent Control Standard (ACS) (2026-09-01).
- OWASP Top 10 for Agentic Applications (2025-12-09).
- OpenAI Deep Research API guidance accessed 2026-10-03: legacy o3-deep-research and o4-mini-deep-research shutdown date was 2026-07-23; new workflows should use the Responses API, and the page identifies gpt-5.6-sol as the replacement. Changing only the model ID is not sufficient.

## Exact policy/evidence relationship

External documents define the assurance baseline; GNW-REP-1.0 defines the GNW runtime enforcement contract and evidence sequence. Neither this note nor a CI PASS is an ISO certification, SOC 2 attestation, or independent security certification.

## Release evidence record

Every production release must retain, for the exact source SHA:

- BuildEvidence.v3 record and immutable commit SHA.
- Clean-tree and diff-check result.
- npm ci result from the committed lockfile.
- Typecheck, lint, unit, integration, RLS and security results.
- Production container build and runtime smoke evidence.
- Dependency audit and secret-scan evidence.
- SBOM, provenance/attestation and container vulnerability evidence.
- Kubernetes manifest and rollout evidence.
- Backup/restore and kill-switch drill evidence.
- Risk register and independent review record.

## Deep Research gate

The Deep Research pilot is fail-closed until its current Responses API integration is implemented and runtime-verified. The repository must not advertise the legacy o3-deep-research path as production-ready.