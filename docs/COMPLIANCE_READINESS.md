# GNW International Assurance Readiness

## Purpose

This document records the control design needed to make GNW auditable against major international security and AI-governance frameworks. It is a readiness map, not a certification or attestation.

## Framework alignment

| Framework / assurance | GNW evidence target |
|---|---|
| ISO/IEC 27001:2022 | ISMS evidence: access control, secure development, supplier/supply-chain controls, logging, incident response, backup, continuity, risk treatment and continual improvement. |
| ISO/IEC 42001:2023 | AI management evidence: AI system inventory, risk assessment, human oversight, lifecycle controls, monitoring, incident handling, transparency, supplier/model governance and continual improvement. |
| SOC 2 Trust Services Criteria | Security, availability, processing integrity, confidentiality and privacy controls mapped to technical + organizational evidence. |
| NIST AI RMF 1.0 | Govern / Map / Measure / Manage evidence covering AI risks, controls, testing and response. |
| NIST AI RMF GenAI Profile | GAI-specific risk register, adversarial testing, provenance, human oversight, monitoring and incident evidence. |
| OWASP Top 10 for Agentic Applications | Agent goal hijack, tool misuse, identity/privilege abuse, agentic supply chain, unexpected code execution, memory/context poisoning, inter-agent communication, cascading failures, human-agent trust exploitation and rogue-agent behavior. |
| OWASP Agent Control Standard | Runtime policy enforcement, action authorization, tool restrictions, traceability, inspection and control-plane evidence. |
| OWASP ASVS / API security practice | Authentication, session security, authorization, input validation, rate limiting, secure headers and error handling. |

## Evidence rule

A framework mapping is not a claim that the organization is certified. Certification/attestation requires organizational scope, policies, operating evidence over time, management review where applicable, and an independent certification body or auditor.

## Required external assurance

For ISO/IEC 27001 and ISO/IEC 42001, use an accredited certification body where certification is required.

For SOC 2, use an independent qualified service auditor for the applicable examination.

For penetration testing, use an independent security testing provider and retain the signed report and remediation evidence.

## GNW technical evidence bundle

Every releasable production revision should retain:

1. Exact source commit SHA.
2. Clean-tree and diff-check output.
3. Committed package-lock.json and successful npm ci output.
4. Typecheck, lint, unit, integration and coverage results.
5. Clean PostgreSQL migration evidence.
6. Forced-RLS and cross-tenant isolation results.
7. Governance/approval/replay/interlock results.
8. SSRF/egress and executor-auth results.
9. Container digest, SBOM, provenance and vulnerability scan.
10. Kubernetes manifest validation and rollout evidence.
11. Health/readiness and smoke-test results.
12. Backup/restore drill evidence.
13. Incident/kill-switch drill evidence.
14. Risk-register state and exceptions.
15. Independent review sign-off.

## Release posture

The release state is DENY/HOLD until all required evidence for the exact release SHA exists. Static code inspection never substitutes for runtime evidence.
