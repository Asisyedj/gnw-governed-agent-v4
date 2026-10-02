import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const required=[
  "package.json","package-lock.json",
  "drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql",
  "docs/PRODUCTION_CLOSURE.md","docs/CONTINUOUS_SECURITY_PROGRAM.md","docs/TRUST_ANCHOR_AND_PENTEST_PLAN.md",
  "src/server/db/schema.ts","src/server/db/index.ts",
  "src/server/governance.ts","src/server/action-envelope.ts","src/server/attestation.ts","src/server/trust-anchor.ts",
  "src/server/execution.ts","src/server/audit.ts","src/server/invariants.ts",
  "src/server/lib/secretsCheck.ts","src/server/llm.ts","src/server/storage.ts","src/server/verified-data.ts","src/tests/unit/verified-data.test.ts",
  "scripts/migrate.mjs","scripts/test-rls.mjs","src/server/metrics.ts","docs/RUNTIME_EXECUTION_POLICY.md"
];

const failures=[];
for(const file of required){if(!existsSync(file)) failures.push(`missing:${file}`);}
const read=file=>existsSync(file)?readFileSync(file,"utf8"):"";
const pkg=read("package.json");
if(!/\"build\"\s*:\s*\"npm run build:server && npm run build:client\"/.test(pkg)) failures.push("package:build-script-missing");
if(!/node_modules/.test(read("package-lock.json"))) failures.push("lockfile:invalid-or-empty");
const schema=read("src/server/db/schema.ts");
if(!schema.includes('from "drizzle-orm/pg-core"')) failures.push("schema:not-postgresql");
if(schema.includes("sqliteTable(")) failures.push("schema:sqlite-runtime-mismatch");
for(const token of ["users_id_tenant_uq","tasks_id_tenant_uq","task_steps_id_tenant_uq","sessions_user_same_tenant_fk","tasks_creator_same_tenant_fk","task_steps_task_same_tenant_fk","approvals_task_same_tenant_fk","budget_task_same_tenant_fk","artifacts_task_same_tenant_fk","capability_task_same_tenant_fk","capability_actor_same_tenant_fk"]){if(!schema.includes(token)) failures.push(`schema:tenant-integrity-missing:${token}`);}
const db=read("src/server/db/index.ts");
if(!db.includes("set_config('app.tenant_id'")) failures.push("db:tenant-context-missing");
if(!/\.transaction\(async tx/.test(db)) failures.push("db:tenant-context-not-transactional");
const exec=read("src/server/execution.ts");
if(!exec.includes("governance.authorize")) failures.push("execution:governance-not-enforced");
const authzIndex=exec.indexOf("governance.authorize"),handlerIndex=exec.indexOf("const output=await handler(");
if(authzIndex<0||handlerIndex<0||authzIndex>handlerIndex) failures.push("execution:handler-before-governance");
for(const token of ["persistCapabilityLease","consumeCapabilityLease","governance_digest_mismatch","teeAttestationRequired","mpcTrustAnchor","requireMpcTrustAnchor"]){if(!exec.includes(token)) failures.push(`execution:trust-control-missing:${token}`);}
const attestation=read("src/server/attestation.ts");
for(const token of ["GNW-TEE-ATTESTATION-V1","cryptoVerify","expectedMeasurement","maxAgeMs"]){if(!attestation.includes(token)) failures.push(`attestation:control-missing:${token}`);}
const trustAnchor=read("src/server/trust-anchor.ts");
for(const token of ["GNW-TRUST-ANCHOR-V1","verifyThresholdAttestation","threshold","participantId"]){if(!trustAnchor.includes(token)) failures.push(`trust-anchor:control-missing:${token}`);}
const governance=read("src/server/governance.ts");
for(const token of ["threshold_trust_anchor_required","tee_threshold_binding_required","threshold_trust_anchor_not_configured"]){if(!governance.includes(token)) failures.push(`governance:threshold-enforcement-missing:${token}`);}
const audit=read("src/server/audit.ts");
if(!audit.includes("setInterlock")) failures.push("audit:required-write-does-not-trip-interlock");
if(!read("drizzle/0002_governance_hardening.sql").includes("audit_log_append_only")) failures.push("audit:append-only-trigger-missing");
const policy=read("docs/RUNTIME_EXECUTION_POLICY.md");
for(const token of ["GNW-REP-1.0","BuildEvidence.v3","OWASP GenAI LLM Top 10 2026","Agent Control Standard","gpt-5.6-sol"]){if(!policy.includes(token)) failures.push(`policy:baseline-missing:${token}`);}
const continuous=read("docs/CONTINUOUS_SECURITY_PROGRAM.md");
for(const token of ["Daily","Weekly","Authorized staging DAST baseline","runtime attestation","Threshold / MPC roadmap"]){if(!continuous.includes(token)) failures.push(`security-program:missing:${token}`);}
const trustPlan=read("docs/TRUST_ANCHOR_AND_PENTEST_PLAN.md");
for(const token of ["TEE trust anchor","Threshold/MPC-compatible trust anchor","Authorized external penetration testing","Red-team scorecard"]){if(!trustPlan.includes(token)) failures.push(`trust-plan:missing:${token}`);}
const llm=read("src/server/llm.ts");
if(!llm.includes("governedFetch")||!llm.includes("assertEgressUrl")) failures.push("llm:production-egress-not-governed");
const secrets=read("src/server/lib/secretsCheck.ts");
for(const token of ["SESSION_SECRET","EXECUTOR_SECRET","GNW_REQUIRE_SIGNED_GRANTS","GNW_GRANT_PRIVATE_KEY_PEM","GNW_GRANT_PUBLIC_KEY_PEM","GNW_LEASE_PRIVATE_KEY_PEM","GNW_EGRESS_ALLOW_LIST"]){if(!secrets.includes(token)) failures.push(`secrets:production-validation-missing:${token}`);}
const envExample=read(".env.example");
for(const token of ["GNW_REQUIRE_TEE_ATTESTATION","GNW_TEE_ATTESTATION_ISSUER","GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM","GNW_TEE_ATTESTATION_MEASUREMENT","GNW_REQUIRE_MPC_TRUST_ANCHOR","GNW_MPC_TRUST_ANCHOR_JSON"]){if(!envExample.includes(token)) failures.push(`env:trust-anchor-setting-missing:${token}`);}
for(const file of ["drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql"]){const sql=read(file);for(const token of ["ENABLE ROW LEVEL SECURITY","FORCE ROW LEVEL SECURITY","current_setting('app.tenant_id'"]){if(!sql.includes(token)) failures.push(`rls:${file}:${token}`);}}
const ci=read(".github/workflows/ci.yml");
if(/continue-on-error:\s*true/.test(ci)) failures.push("ci:fail-open");
if(!ci.includes("contents: read")) failures.push("ci:repository-permission-not-readonly");
if(ci.includes("npm install --package-lock-only")) failures.push("ci:lockfile-mutated-in-ci");
if(ci.includes("git push")) failures.push("ci:source-mutation-present");
if(!ci.includes("npm run verify:rls")) failures.push("ci:rls-gate-missing");
if(!ci.includes("npm run verify:production")) failures.push("ci:production-gate-missing");
if(!ci.includes("npm audit --audit-level=high")) failures.push("ci:dependency-audit-missing");
if(!ci.includes("gnw_migrator")) failures.push("ci:dedicated-migrator-missing");
if(!ci.includes("TRUST_PROXY") && ci.includes("CORS_ORIGIN")) failures.push("ci:proxy-origin-policy-incomplete");
for(const workflow of [".github/workflows/continuous-security.yml",".github/workflows/red-team-regression.yml",".github/workflows/staging-security-test.yml",".github/workflows/security-watch.yml",".github/workflows/external-pentest-baseline.yml"]){if(!existsSync(workflow)) failures.push(`ci:security-workflow-missing:${workflow}`);}
const continuousWorkflow=read(".github/workflows/continuous-security.yml");
if(!continuousWorkflow.includes('cron: "17 2 * * *"')) failures.push("ci:daily-assurance-schedule-missing");
const redTeamWorkflow=read(".github/workflows/red-team-regression.yml");
if(!redTeamWorkflow.includes('cron: "41 4 * * 6"')) failures.push("ci:weekly-red-team-schedule-missing");
const stagingWorkflow=read(".github/workflows/staging-security-test.yml");
if(!stagingWorkflow.includes("zap-baseline.py")) failures.push("ci:staging-dast-baseline-missing");
if(!stagingWorkflow.includes("security-testing")) failures.push("ci:active-scan-protected-environment-missing");
const watchWorkflow=read(".github/workflows/security-watch.yml");
if(!watchWorkflow.includes('cron: "13 */6 * * *"')) failures.push("ci:six-hour-watch-schedule-missing");
const pentestWorkflow=read(".github/workflows/external-pentest-baseline.yml");
if(!pentestWorkflow.includes("confirm_authorization")) failures.push("ci:pentest-authorization-gate-missing");
if(!pentestWorkflow.includes("STAGING_BASE_URL")) failures.push("ci:pentest-target-secret-missing");
if(!pentestWorkflow.includes("zaproxy/action-baseline@de8ad967d3548d44ef623df22cf95c3b0baf8b25")) failures.push("ci:pentest-action-not-pinned");
const release=read(".github/workflows/release.yml");
if(release.includes("softprops/action-gh-release")) failures.push("release:unsupported-release-action");
if(release.includes("npm install --package-lock-only")) failures.push("release:lockfile-mutated");
if(!release.includes("npm run verify:production")||!release.includes("npm run verify:rls")) failures.push("release:closure-gates-missing");
const docker=read(".github/workflows/docker-publish.yml");
if(docker.includes("branches: [main]")) failures.push("docker:production-publish-on-branch");
if(docker.includes("npm install --package-lock-only")) failures.push("docker:lockfile-mutated");
if(!docker.includes("provenance: true")||!docker.includes("sbom: true")) failures.push("docker:attestation-metadata-missing");
if(!docker.includes("trivy-action")) failures.push("docker:vulnerability-scan-missing");
const workflowDir=".github/workflows";
if(existsSync(workflowDir)){
 for(const name of readdirSync(workflowDir)){
  if(!/\.ya?ml$/.test(name)) continue;
  const text=read(`${workflowDir}/${name}`);
  const unpinned=[...text.matchAll(/uses:\s*([^\s]+)@([^\s]+)/g)].filter(m=>!/^([0-9a-f]{40})$/.test(m[2])).map(m=>m[0]);
  if(unpinned.length) failures.push(`workflow:unpinned-actions:${name}:${unpinned.join(",")}`);
 }
}
const ns=read("k8s/namespace.yaml");
for(const token of ["pod-security.kubernetes.io/enforce: restricted","pod-security.kubernetes.io/audit: restricted","pod-security.kubernetes.io/warn: restricted"]){if(!ns.includes(token)) failures.push(`k8s:pod-security-label-missing:${token}`);}
const crypto=read("scripts/verify-cryptographic-closure.mjs");
if(!crypto) failures.push("crypto:verifier-missing");
else for(const token of ["GNW-ACTION-ENVELOPE-V1","GNW-TEE-ATTESTATION-V1","GNW-TRUST-ANCHOR-V1","executor_action_digest_required"]){if(!crypto.includes(token)) failures.push(`crypto:verifier-control-missing:${token}`);}
const deployment=read("k8s/deployment.yaml");
for(const token of ["runAsNonRoot: true","readOnlyRootFilesystem: true","allowPrivilegeEscalation: false","drop: [\"ALL\"]","seccompProfile:","emptyDir:","sizeLimit: 128Mi"]){if(!deployment.includes(token)) failures.push(`k8s:deployment-hardening-missing:${token}`);}
try{execFileSync("git",["rev-parse","--is-inside-work-tree"],{stdio:"ignore"});execFileSync("git",["diff","--check"],{stdio:"ignore"});}catch{failures.push("git:checkout-or-diff-check-unavailable");}
if(failures.length){console.error("GNW production closure: DENY");for(const failure of failures) console.error(` - ${failure}`);process.exit(1);}
console.log("GNW production closure: static gate PASS");
