# GNW Production Certification — evidence and decision policy

## Current status

**NOT CERTIFIED.** Source packaging and isolated CI verification do not prove that ten external integrations work in a live environment. Certification must remain `HOLD` until all required gates have evidence for the exact candidate commit and artifact digest.

## Mandatory gates

| Gate | Minimum acceptable evidence | Current state in this package |
|---|---|---|
| Source identity | Exact commit SHA, clean checkout, artifact SHA-256 | Must be collected in the Git repository |
| Reproducible build | `npm ci`, typecheck, lint, tests, build from lockfile | Not executed in this turn; workflow added |
| Database/RLS | Clean migration, least-privilege runtime role, cross-tenant DML, forced RLS, composite FK checks | Test suite added; live result pending |
| Approval/replay | Exact-action approval binding, separated approver, nonce replay, fail-closed interlock | Existing controls exercised by tests; full live evidence pending |
| Ten live integrations | One evidence record per real provider/tool with timestamps, request IDs, sanitized inputs/outputs and status | **NOT TESTED** |
| Live E2E mission | End-to-end task from authenticated request through governed tool execution and audit chain | **NOT TESTED** |
| Backup/restore | Actual dump, restore into isolated target, post-restore integrity checks | Existing CI drill exists; candidate CI rerun pending |
| Staging rollback | Allowlisted reversible migration, generated dump digest, postcondition and ledger verification | CI-only reversible fixture added; real staging rollback pending |
| Security assessment | Threat-model mapping, dependency audit, secret scan, negative tests and residual risks | Partial; new workflow runs some gates |
| Supply chain | SBOM, provenance, artifact digest binding and signature verification | Must be collected on release candidate |
| Operational readiness | Alerting, runbooks, kill-switch drill, key rotation and incident owner | Documents exist; current live drills pending |
| Independent review | Reviewer distinct from release owner and signed decision evidence | **NOT APPROVED** |

## Decision rule

- Any required gate `FAIL` → `DENY`.
- Any required gate `BLOCKED` or `NOT_TESTED` → `HOLD`.
- All gates `PASS`, same candidate SHA and artifact digest, plus independent approval → eligible for a scope-bounded release authorization.

The local verifier checks the shape and binding of a completed evidence file; it does not independently rerun external tests, authenticate a reviewer signature, or issue an accredited certificate. No status is certified merely because a workflow is green.

## Required evidence file

Copy `docs/gnw-production-certification-evidence.schema.json` as the schema contract and prepare `certification/evidence.json` from actual run evidence. Do not set a gate to `PASS` until the referenced artifact or report exists and was produced from the candidate SHA. The validator requires evidence for all gate categories and rejects a self-review where reviewer equals release owner.

Run from a clean Git checkout after evidence collection:

```bash
npm run verify:certificate -- --evidence=certification/evidence.json --output=certification/verification-result.json
```

Only an `EVIDENCE_COMPLETE_FOR_INDEPENDENT_RELEASE_AUTHORIZATION` result is emitted after structural checks pass. That is not an automatic production deployment authorization.
