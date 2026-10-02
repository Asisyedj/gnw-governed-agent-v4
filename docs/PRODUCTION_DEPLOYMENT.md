# GNW Production Deployment Runbook

## Release sequence

1. Merge the reviewed production-hardening PR only after required GitHub checks are green.
2. Create an annotated release tag from the exact reviewed commit.
3. Run `npm ci`, `npm run verify:production`, `npm run verify:rls`, tests, coverage and build against the same commit.
4. Run `npm run verify:production:env` in the production deployment environment.
5. Build and scan the container; record its immutable image digest, SBOM and provenance.
6. Deploy the exact digest to the Kubernetes `gnw` namespace.
7. Wait for startup, readiness and rollout completion.
8. Run health, authentication, task, approval, interlock and audit smoke tests.
9. Verify the kill-switch drill in a controlled window.
10. Record the full evidence bundle under the release SHA.

## Production environment prerequisites

- A real public HTTPS hostname with a managed certificate.
- PostgreSQL TLS with a CA trusted by the GNW workload and `sslmode=verify-full` semantics.
- A runtime DB role with `NOSUPERUSER` and `NOBYPASSRLS`; migrations use a separate role.
- Production secrets from an approved secret manager.
- An authenticated and sandboxed executor endpoint over HTTPS.
- Explicit GNW outbound allowlist.
- Shared artifact storage across all application replicas.
- Kubernetes Pod Security `restricted` enforcement and a CNI that enforces the declared NetworkPolicy.
- A production ingress controller and, where needed, cert-manager.

## Rollback

1. Freeze new governed work with the kill switch.
2. Preserve the failing release SHA and evidence.
3. Roll back the Deployment to the previously verified image digest.
4. Verify database schema compatibility before rollback; never roll back the application across an irreversible migration without the documented database rollback plan.
5. Re-run health/readiness and representative governed-action smoke tests.
6. Keep the incident and evidence package for the post-run review.

## Emergency stop

Use `docs/runbook-kill-switch.md`. Do not bypass the control plane with arbitrary pod shell commands.

## Assurance package

Attach:

- release commit SHA
- image digest
- CI run URLs
- SBOM and provenance
- dependency and secret scan results
- CodeQL and Scorecard evidence
- RLS evidence
- governance/approval/replay/interlock evidence
- container scan and smoke output
- Kubernetes rollout output
- backup/restore drill
- kill-switch drill
- risk register state
- independent security review

Technical evidence establishes implementation readiness. It does not itself issue ISO/IEC certification or SOC 2 attestation.