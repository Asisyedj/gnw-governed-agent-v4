# GNW Evidence Matrix

## Release gate

| Control family | Required artifact | Pass condition |
|---|---|---|
| Source integrity | commit SHA + clean tree | exact SHA, clean checkout |
| Dependency integrity | package-lock.json + npm ci | install succeeds without lockfile mutation |
| Static correctness | typecheck/lint | zero blocking errors |
| Tests | unit/integration/security | all required suites pass |
| Database | migrations + RLS evidence | clean migration and hostile tenant tests pass |
| Governance | approval/replay/interlock evidence | fail-closed paths proven |
| Execution | executor auth/sandbox evidence | unauthorized or expired requests rejected |
| Egress | SSRF and LLM egress tests | private/unapproved destinations rejected |
| Audit | required-write failure drill | circuit trips and new governed work stops |
| Trajectory | chain/root tamper tests | any modification is detected |
| Supply chain | action pins + SBOM + provenance | immutable evidence present |
| Container | vulnerability scan + smoke | HIGH/CRITICAL policy satisfied and health passes |
| Kubernetes | manifest/policy validation | restricted posture and rollout probes validate |
| Operations | backup/restore + kill-switch drills | recovery and stop controls proven |
| Compliance | risk register + review | no unexplained release exceptions |

## Evidence retention

Retain source, CI, release, container and operational evidence under the release SHA. Keep evidence immutable or write-once where the chosen compliance program requires it.
