# GNW AI / Agent Risk Register

| ID | Risk | Preventive control | Detection/evidence | Response |
|---|---|---|---|---|
| R-001 | Prompt/goal hijack | Treat model/external content as untrusted; policy outside model; least privilege | Adversarial prompt suite; denied tool events | Stop governed execution and review action digest |
| R-002 | Tool misuse | Explicit agent-tool scope and governance authorization | Governance decision logs | Deny action; trip circuit on control failure |
| R-003 | Identity/privilege abuse | Tenant/actor binding, RBAC, signed grants, capability leases | Authorization/replay tests | Revoke lease; kill switch if compromise suspected |
| R-004 | Cross-tenant disclosure | PostgreSQL FORCE RLS + transaction-scoped tenant context + composite tenant FKs | RLS isolation script | Block release; investigate database role and policies |
| R-005 | Unexpected code execution | Separate authenticated executor; sandbox/resource limits; no direct shell path | Executor auth and sandbox tests | Disable executor; engage circuit |
| R-006 | SSRF / internal network access | HTTPS, host allowlist, DNS resolution, private-address blocking, controlled redirects | SSRF test suite | Deny egress; alert |
| R-007 | Agentic supply-chain compromise | Pinned CI actions, secret scanning, dependency review, SBOM/provenance, image scanning | CI artifacts and Scorecard/CodeQL | Block release and rotate affected trust material |
| R-008 | Memory/context poisoning | Tenant-scoped memory access and provenance-bound evidence | Context integrity tests | Discard tainted context and stop affected task |
| R-009 | Unbounded consumption | Token/byte/tool/time budgets and reservations | Budget exhaustion/latency metrics | Deny further execution |
| R-010 | Audit/evidence outage | Required audit writes fail closed and trip circuit | Audit-failure metric | Stop new governed side effects |
| R-011 | Cascading failures | Circuit breaker, kill switch, bounded retries/timeouts | Error-rate/circuit alerts | Isolate dependency and halt affected actions |
| R-012 | Data exfiltration | Egress allowlist, private artifact storage, least-privilege credentials | Egress denies and artifact lineage | Revoke credentials, preserve evidence |
| R-013 | Model/provider compromise or outage | Provider allowlist, signed configuration, provider isolation | Provider health and response validation | Fail closed or use approved fallback only |
| R-014 | Human approval bypass | Digest-bound approval + nonce + expiry + separation of duties | Approval replay/tamper tests | Deny and audit |
| R-015 | Rogue agent behavior | Explicit specialist scopes, runtime governance, interlocks, trajectory integrity | Chain/root verification and policy logs | Stop task and preserve evidence |
