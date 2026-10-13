# GNW Gate 1 — AWS Secrets Manager on EC2 + Docker Compose

**Status:** PLAN / NOT IMPLEMENTED / NOT APPROVED  
**Target branch:** `security/gate1-aws-secrets-ec2-plan-2026-10-13`  
**Release posture:** Production STRICT HOLD. No AWS account, IAM, secret, EC2, or production configuration was changed by this plan.

## 1. Scope and non-goals

Implement a production-capable AWS Secrets Manager provider for GNW's existing `SecretProvider` interface, using an EC2 instance profile role and AWS SDK for JavaScript v3. This plan covers design, least-privilege policy, staging-only validation, redaction, rotation behavior, and evidence requirements.

This plan does NOT create or modify AWS resources, retrieve or migrate real secrets, deploy workloads, change production environment variables, or approve production release. Do not put secret values in GitHub, Compose files, image layers, shell arguments, test output, or this document.

## 2. Current repository observations

- `src/server/lib/secret-provider.ts` defines the provider abstraction and has an AWS placeholder, not an AWS implementation.
- `secret-manifest.staging.json` currently selects `env-file`.
- `scripts/preflight-secrets.mjs` validates values loaded from environment files; it does not call AWS Secrets Manager.
- `docker-compose.production.yml` currently passes sensitive configuration through environment variables. Migration to Secrets Manager must be a deliberate follow-up, not an incidental change in this plan.

## 3. Target architecture

1. EC2 instance receives a dedicated instance profile role using the EC2 service principal.
2. GNW process uses AWS SDK default credential resolution; no long-lived access key is configured in GNW.
3. The provider calls `GetSecretValue` only for exact configured secret ARNs in the selected environment/region.
4. Secret payloads are parsed and validated in memory; logs report only logical secret key, operation category, and safe AWS request metadata. Never log returned secret values or serialized SDK responses.
5. Startup preflight fails closed if any required secret is missing, denied, malformed, empty, or unavailable.
6. Production and staging have separate roles, secret ARNs, manifests, and account/environment boundaries.

## 4. EC2 + Docker Compose-specific threat model

An EC2 instance profile is attached to the host, not intrinsically isolated to one Compose service. Any process/container that can reach instance metadata may be able to obtain credentials for the instance role. Therefore:

- Use a dedicated EC2 host for GNW production workloads; do not co-host untrusted containers or unrelated applications.
- Require IMDSv2 and configure the smallest compatible metadata response hop limit; validate the exact Docker networking topology before choosing a value.
- Apply host firewall/network controls so only the intended workload can reach the instance metadata endpoint. Test both allowed and denied paths; do not rely on a Compose network declaration alone as a security boundary.
- Do not expose Docker socket to the application container. Run as non-root, drop Linux capabilities, use read-only root filesystem where compatible, and use resource limits.
- If per-container IAM isolation is a hard requirement, do not assume an EC2 instance profile provides it. Reassess a credential broker or a workload platform with per-task identity before production approval.
- Keep SSH/admin access separate and audited; do not grant operator/admin IAM permissions to the runtime role.

## 5. IAM role design

### Trust policy template (placeholder-only)

Replace the account and role placeholders during a reviewed staging setup. Do not commit real account IDs if repository policy treats them as sensitive; never put credentials here.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEC2AssumeRole",
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Attach this role only to the designated GNW staging EC2 instance profile for the initial drill. Production gets a separate role only after staging acceptance and explicit approval.

### Runtime permission policy template

Replace each placeholder with exact full secret ARNs for the correct staging region/account. Avoid wildcards in Resource. Do not grant `ListSecrets`, `CreateSecret`, `PutSecretValue`, `UpdateSecret`, `DeleteSecret`, `RotateSecret`, or IAM management actions to the application role.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOnlyApprovedGnwStagingSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:gnw/staging/<SECRET_NAME>-<SUFFIX>"
      ]
    }
  ]
}
```

If a customer-managed KMS key encrypts these secrets, add a separate narrowly scoped `kms:Decrypt` permission for only that key and, where supported by the chosen key policy, constrain it with the Secrets Manager encryption context (SecretARN). Do not add KMS permissions pre-emptively when the AWS-managed Secrets Manager key is used.

### Policy validation

- Confirm the role's trust policy allows EC2 only and is attached to the intended instance profile.
- Run IAM Access Analyzer / policy validation and inspect effective permissions.
- Verify `GetSecretValue` succeeds for one approved staging secret.
- Verify a different secret ARN, secret listing, secret write/delete, and IAM modification are denied.
- Save redacted policy JSON and test outputs; never save secret values or temporary credentials.

## 6. Implementation plan

### G1.1 — Provider and manifest
- Add `@aws-sdk/client-secrets-manager` (v3) and lockfile update.
- Implement `AwsSecretsManagerProvider` behind the existing interface with explicit region and exact secret-ID allowlist.
- Accept only the configured secret response format; fail closed on absent `SecretString`, invalid JSON, wrong field types, or missing required fields.
- Validate manifest schema, provider name, required fields, ARN/region consistency, and duplicate or unapproved IDs.
- Keep `env-file` restricted to non-production. Do not add static AWS key configuration.

### G1.2 — Preflight integration
- Update the preflight entry point to select provider from an explicit manifest.
- Return only status, logical key names, and safe failure categories; redact exception details that may contain request or configuration data.
- Set non-zero exit code on any required secret failure.
- Keep staging and production manifests separate; do not silently fall back from AWS to env-file.

### G1.3 — Runtime integration
- Integrate secret resolution before application initialization and map values to the existing configuration contract in memory.
- Avoid writing fetched values back to process arguments, disk, generated Compose files, or logs.
- Document cache lifetime and rotation semantics. The first implementation must either refresh secrets safely or explicitly require a controlled restart after rotation; do not claim automatic rotation without a test.
- Ensure shutdown closes the AWS client.

### G1.4 — Tests
- Unit tests with a mocked Secrets Manager client: success, missing SecretString, access denied, throttling, timeout, invalid JSON, unknown ID, region mismatch, and safe redaction.
- Integration tests in a dedicated staging account/role using synthetic disposable secret values only.
- IAM negative tests proving least privilege.
- EC2 metadata tests for IMDSv2 and container access restrictions.
- Startup fail-closed tests for each required secret.
- Rotation drill proving either refresh or documented restart behavior.
- No production secret values or production resource mutations in tests.

## 7. Security acceptance criteria

Gate 1 cannot pass until all items have inspectable evidence:

- [ ] Provider uses AWS SDK v3 and EC2 instance-profile credentials; no static AWS access keys.
- [ ] Staging runtime role has exact-resource read-only access and no secret-management privileges.
- [ ] Cross-secret and write/delete/list attempts are denied.
- [ ] IMDSv2 and Docker/host network restrictions are verified from both allowed and denied containers/processes.
- [ ] Required secret failures stop startup; no environment-file fallback in AWS mode.
- [ ] Logs, error paths, audit events, and test reports contain no secret values.
- [ ] Rotation behavior is tested and documented.
- [ ] CloudTrail records test retrieval events; evidence does not contain secret values.
- [ ] Typecheck, lint, full unit tests, build, and relevant security tests pass on the exact commit.
- [ ] Independent reviewer signs off the evidence bundle.

## 8. Evidence bundle

Store only redacted artifacts:
- commit SHA and file hashes;
- IAM trust/permission policy JSON with account identifiers redacted if required;
- policy validation and explicit allow/deny results;
- test logs with secret values and credentials removed;
- CloudTrail event IDs/timestamps for synthetic staging secret retrieval;
- IMDSv2 and network control test results;
- rotation drill report;
- reviewer identity, decision, timestamp, and unresolved findings.

## 9. Release decision

**Gate 1 status: NOT STARTED / PLAN RECORDED.** Repository plan alone is not evidence that AWS integration exists or works.

**Production remains STRICT HOLD.** No merge to `main`, production secret migration, IAM production changes, or deployment until Gate 1 passes independently and Gates 2–4 receive their own approvals.
