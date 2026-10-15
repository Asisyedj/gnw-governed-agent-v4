# GNW Staging Deployment and Rollback Runbook

**Status:** PROCEDURE TEMPLATE — not authorization to deploy.  
**Repository:** Asisyedj/gnw-governed-agent-v4  
**Current baseline at authoring:** a5e027416232d6b8b8219724e81792a6175093fb  
**Release decision:** HOLD until every target and approval field is verified.

## 1. Required target record — do not proceed while any required item is unknown

Record these non-secret values in the release evidence pack:

- Cloud provider/account or subscription:
- Project / service / environment IDs:
- HTTPS staging base URL and health/readiness endpoint:
- GitHub Environment name and required reviewers:
- Deployment workflow URL and workflow identity:
- Authorized operator and change/approval reference:
- Confirmation staging database, data, credentials and network are isolated from production:
- Current deployed commit and immutable image digest:
- Previous known-good deployment ID and immutable image digest:
- Rollback operator, change window and escalation contact:

Do not invent hostnames or IDs. Do not copy production credentials or data into staging. Never put secret values in the evidence pack or chat.

## 2. Pre-deployment authorization and checks

1. Confirm the target is owned by GNW and explicitly designated for staging.
2. Confirm written approval, change window, operator identity and a separate reviewer.
3. Confirm production isolation for data, database, secrets, IAM/RBAC and network access.
4. Confirm HTTPS/TLS hostname validation, health/readiness route and monitoring.
5. Confirm the provider-native deployment and rollback mechanisms and that the prior known-good revision remains available.
6. Build and scan the exact candidate commit. Record its immutable image digest, SBOM digest and provenance/signature verification. Do not deploy a mutable tag alone.
7. If any prerequisite is missing, stop and keep the release decision HOLD.

## 3. Deploy to staging

1. Use only the approved provider-native deployment pipeline for the recorded staging service.
2. Deploy the approved commit and immutable image digest; do not deploy to production.
3. Record UTC start/end times, operator, workflow/run ID, deployment ID, commit SHA and image digest.
4. Verify the live deployment identity matches the intended commit and digest.
5. Run TLS, health/readiness, smoke, authentication/RBAC, tenant isolation, PostgreSQL RLS, audit/governance, kill-switch/interlock, SSRF/egress, rate-limit and error-redaction checks.
6. Run the authorized staging security scan only after target scope is confirmed. Save reports as access-controlled artifacts and redact sensitive output.
7. If deployment or validation fails, stop promotion and follow the rollback procedure below.

## 4. Application rollback drill

1. Before changing anything, record the current deployment ID and immutable image digest.
2. Confirm the named rollback operator, approval and provider-native rollback action.
3. Restore the recorded previous known-good deployment/image digest using the provider's supported rollback mechanism. Do not improvise a command for an unknown provider.
4. Verify the restored deployment identity, TLS, health/readiness, core smoke tests, authentication and audit logging.
5. Record UTC timestamps, operator, action, source and restored deployment IDs/digests, results, logs/report URI and evidence SHA-256.
6. If rollback fails or the restored service is unhealthy, stop further changes and invoke the incident/escalation process. Do not promote to production.

## 5. Database migration rollback is separate

The repository script `scripts/staging-rollback.mjs` handles a guarded staging database migration rollback; it is not a substitute for application rollback.

Before running it, verify the script's current safeguards, staging-only endpoint allowlist, approved migration/rollback checksums, backup/dump path, restore procedure, explicit `ROLLBACK-STAGING` confirmation, and operator authorization. Use only an isolated staging database. Verify database postconditions and application health afterward. A disposable CI database drill does not count as a live staging rollback.

## 6. GitHub secret handling

After the owner verifies the real staging HTTPS URL, set `GNW_STAGING_BASE_URL` directly in GitHub Actions settings, preferably as a protected-environment-scoped secret. Never put its value in commits, artifacts, logs or chat.

The existing `.github/workflows/staging-security-test.yml` scans an existing target; it does not provision or deploy an application and does not perform application rollback. Its active scan is potentially intrusive and must be explicitly authorized for the verified staging target. Check that the job's GitHub Environment protection and secret scope are correctly wired before relying on them.

## 7. Evidence and release gate

Populate `docs/release-evidence/STAGING_IMAGE_PROVENANCE_EVIDENCE_TEMPLATE.md` with verified target identity, commit/image digests, run IDs, test reports, scan results, rollback proof, timestamps and independent approvals. Hash the evidence bundle and restrict access.

Production remains **HOLD / NO-GO** until live staging smoke tests pass, a real staging rollback succeeds and is independently verified, the exact image digest has reviewed scan/SBOM and signed provenance, and required independent approvals are recorded. CI passing alone is not production authorization.
