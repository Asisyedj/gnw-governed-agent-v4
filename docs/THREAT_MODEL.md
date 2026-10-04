# GNW Threat Model

## Assets
- Evidence integrity and provenance
- Tenant isolation
- Authorization capabilities and approvals
- Audit trajectory and final decisions
- Model/API credentials and external egress
- Human control paths and interlocks

## Trust boundaries
1. Browser -> authenticated API
2. API -> PostgreSQL
3. Governor -> bounded workers
4. Workers -> tool adapters
5. Tool adapters -> external services
6. Governance pipeline -> final structured decision

## Primary threats and controls
| Threat | Required control |
|---|---|
| Goal/prompt hijack | capability boundary outside the model; adversarial corpus |
| Tool misuse | action envelope, allowlisted tools, governed executor |
| Identity/privilege abuse | tenant binding, capability leases, approvals, RLS |
| Evidence poisoning | provenance, source family, derivative detection |
| Forced conclusion | UNKNOWN state and minimum evidence gate |
| Comparator bias | symmetric evidence/threshold evaluator |
| Unauthorized mutation | append-only DB triggers for evidence/reviews/challenges/decisions/audit |
| SSRF / unsafe egress | HTTPS-only, DNS resolution, private-range block, host allowlist |
| Replay | nonce/approval binding and expiration |
| Model failure | provider adapter boundary, timeout, structured output validation |
| Resource exhaustion | token/byte budgets and reservations |
| Audit loss | required audit writes fail closed into interlock |
| Cross-tenant disclosure | FORCE RLS plus transaction-scoped tenant context |

## Verification strategy
Security tests must prove denial, not merely successful use. Adversarial tests cover role hijack, privilege escalation, approval bypass, evidence independence attacks and suppression of UNKNOWN.

## Residual risks
PostgreSQL-backed integration and deployment runtime must still execute in CI or a controlled environment with PostgreSQL 16 available. Local Windows validation cannot claim those runtime gates without that dependency.

## External alignment
The test taxonomy is aligned with OWASP's 2025 agentic and LLM risk categories and NIST AI RMF / Generative AI profile concepts. Alignment is a security engineering aid, not a claim of formal certification.