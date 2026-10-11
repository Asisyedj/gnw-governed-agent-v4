# GNW Release Sign-off Audit

## Candidate identity
- Commit SHA:
- Artifact SHA-256:
- Environment:
- Release scope:
- Audit date/time (UTC):

## Required gates
| Gate | Evidence reference | Status (PASS/FAIL/BLOCKED/NOT TESTED) | Reviewer | Notes / residual risk |
|---|---|---|---|---|
| Source identity / clean checkout | | NOT TESTED | | |
| Clean install, typecheck, lint, tests, build | | NOT TESTED | | |
| RLS and tenant isolation | | NOT TESTED | | |
| Approval, exact-action binding, replay denial | | NOT TESTED | | |
| Audit ledger integrity / retention | | NOT TESTED | | |
| Ten live tool integrations, no mocks | | NOT TESTED | | |
| End-to-end authenticated mission | | NOT TESTED | | |
| Backup restore drill | | NOT TESTED | | |
| Staging rollback drill | | NOT TESTED | | |
| Security tests / threat model / secrets | | NOT TESTED | | |
| SBOM, provenance, signature, digest binding | | NOT TESTED | | |
| Observability, kill-switch, incident runbook | | NOT TESTED | | |
| Independent reviewer decision | | NOT TESTED | | |

## Decision rule
- Any required FAIL: DENY.
- Any required BLOCKED or NOT TESTED: HOLD.
- All gates PASS, exact candidate/artifact identity verified and independent reviewer approves: eligible for scope-bound authorization.

## Sign-off
- Release owner:
- Independent reviewer (must differ from release owner):
- Decision: HOLD / DENY / APPROVE FOR DEFINED SCOPE
- Signed evidence reference:
- Explicit exclusions and residual risks:
