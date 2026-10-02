# GNW Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ |

## Reporting a Vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Set the production security contact to an organization-controlled address before release.

## Security Boundaries

GNW treats the model as an untrusted decision component. Authorization, tenant isolation, approval, capability, budget, egress and execution controls are enforced outside the model.

## Implemented Controls

- Fail-closed kill switch and circuit breaker.
- Role-based access control: owner / admin / operator / viewer.
- Session cookies are HttpOnly, Secure in production and SameSite=Lax.
- Passwords use bcrypt with 12 rounds.
- Global and authentication-specific rate limits.
- Helmet CSP/HSTS and secure response headers.
- PostgreSQL transaction-scoped tenant context using `set_config('app.tenant_id', ..., true)`.
- PostgreSQL RLS with `FORCE ROW LEVEL SECURITY` and tenant policies.
- Composite parent/child tenant foreign keys for identity and resource integrity.
- Signed grant verification, nonce replay protection and bounded budgets.
- Signed capability leases tied to action digest, tenant, task, actor and interlock generation.
- Required audit writes fail closed by opening the circuit breaker when evidence cannot be persisted.
- Trajectory chain hashing and root verification.
- HTTPS-only, allowlisted, DNS-resolved outbound requests with private-address blocking.
- Production LLM egress is forced through the governed egress path and response-size limit.
- Executor requests are HMAC-authenticated and time-bounded.
- Production artifact storage fails closed unless shared storage has been explicitly confirmed.
- Non-root, read-only, capability-dropped containers with seccomp RuntimeDefault.
- Kubernetes Restricted Pod Security labels and constrained NetworkPolicy.
- CI uses read-only repository permissions and immutable action commit pins.
- Secret scanning, dependency review, CodeQL and OSSF Scorecard.
- Container SBOM, provenance attestation and HIGH/CRITICAL vulnerability scanning.

## Production Preconditions

Before production deployment, populate secrets through an approved secret manager, configure the real ingress hostname/TLS certificate, verify the PostgreSQL CA/hostname with `verify-full` semantics, provide an approved shared artifact store, deploy the executor sandbox, and record the exact release image digest.

These are environment-specific deployment inputs, not values to place in source control.
