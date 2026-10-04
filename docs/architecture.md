# GNW Governed Agent v4 — Architecture

## Governance topology
Human Principal -> Central Governor -> Research / Specialist Workers -> Evidence Auditor -> Red Team -> Bias Auditor -> Justice Reviewer -> Final Arbiter.

Software roles are governance controls; historical justice principles are design inspiration, not religious offices.

## Mandatory control path
1. Authenticate actor and bind tenant, actor, task, request and capability context.
2. Canonicalize and hash the intended action.
3. Evaluate governance and interlocks before any side effect.
4. Require human approval for classified/high-impact operations and bind approval to the exact action digest, tenant, request and nonce.
5. Reserve budgets before execution and reject replay/expired grants.
6. Execute only through the governed executor/tool path.
7. Persist append-only audit, evidence, review, challenge and decision records.
8. Persist and verify the trajectory chain/root before task completion.
9. Enforce PostgreSQL tenant isolation with FORCE ROW LEVEL SECURITY and transaction-scoped app.tenant_id.
10. Release only when static, unit, integration, database/RLS, security, evaluation and deployment evidence pass.

## Role permissions
| Role | Allowed capabilities | Forbidden |
|---|---|---|
| Human Principal | all | none |
| Central Governor | read, route | final decision |
| Research Worker | read, append evidence | permissions, side effects |
| Evidence Auditor | read, append, provenance | permissions, side effects |
| Specialist Worker | read, analyze | writes, final decision |
| Red Team | read, challenge | writes, side effects |
| Bias Auditor | read, challenge | writes, side effects |
| Justice Reviewer | read, review | final decision |
| Final Arbiter | read, final decision | permissions, evidence mutation |

## Evidence chain
Context -> Principle -> Policy -> Implementation -> Experience/Distribution -> Outcome -> Correction.

Normative text is not implementation proof. Repeated derivative reports are not independent witnesses. Unknown is valid. The same evidence standard applies to Ali and every comparator. Resilience is contextual, not a justice score.

## Justice review
The reviewer must cover exactly six dimensions:
- Rule-bound and accessible justice
- Material and social justice
- Impartial administration
- Protection from arbitrary coercion
- Voice, accountability and correction
- Equal civic standing and group protection

## Production enforcement
Model providers are adapters, not authority. External side effects are disabled by default. The authorization and execution boundaries enforce controls outside the model.