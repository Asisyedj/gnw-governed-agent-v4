# GNW 19-Stage Verification Matrix

| Stage | Implementation | Automated evidence | Release gate |
|---|---|---|---|
| 01 Architecture Contract | governance-contract.ts + docs | role/capability tests | PASS |
| 02 Domain Schemas | typed domain + DB schema | typecheck | PASS |
| 03 Permission Engine | role/capability boundary | negative escalation tests | PASS |
| 04 Evidence Engine | evidence-engine.ts | independence/unknown tests | PASS |
| 05 Provenance/Audit | audit + append-only SQL | integrity/static checks | PASS |
| 06 Worker Framework | agent-pipeline.ts worker contracts | pipeline tests | PASS |
| 07 Model Abstraction | LLM client/config boundaries | typecheck + failure tests | PASS/HOLD |
| 08 Central Governor | governed pipeline routing | gate-order test | PASS |
| 09 Justice Framework | six-dimension rubric | completeness/failure tests | PASS |
| 10 Final Arbiter | final-decider boundary | permission + pipeline tests | PASS |
| 11 Tool/Website Layer | SSRF + governed egress | SSRF test suite | PASS |
| 12 Unit Testing | Vitest unit suites | unit execution | PASS |
| 13 Integration Testing | API + pipeline suites | PostgreSQL-backed integration | REQUIRED |
| 14 Adversarial Security | fail-closed boundaries | red-team pipeline + security tests | REQUIRED |
| 15 Golden Evaluation | benchmark cases | evaluation suite | REQUIRED |
| 16 Bias Validation | comparator symmetry checks | bias suite | REQUIRED |
| 17 Justice Validation | review gate | six-dimension suite | PASS |
| 18 Production Hardening | Docker/K8s/health/observability | build/deploy validation | REQUIRED |
| 19 Final Certification | closure script + evidence | same-commit release bundle | BLOCKING |

## Runtime invariants
- Least privilege is enforced outside the model.
- Workers cannot delete evidence or change permissions.
- Unknown is a valid outcome.
- Normative text is not implementation proof.
- Repeated derivative reports are not independent witnesses.
- Evidence standards are symmetric across comparators.
- External side effects are disabled by default.

## External security alignment
GNW validation explicitly covers prompt-injection/agent-goal-hijack, tool misuse, identity and privilege abuse, supply-chain integrity, output validation, resource bounds, auditability and fail-closed execution. OWASP's current agentic guidance emphasizes goal hijack, tool misuse and identity/privilege abuse; OWASP's LLM guidance covers prompt injection and insecure output handling. NIST AI RMF remains the governance-risk framework and its GenAI profile provides generative-AI-specific risk actions.

## Certification rule
No static inspection may infer production readiness. The final state remains HOLD until runtime database/RLS, deployment, security, golden evaluation and same-commit evidence all pass.