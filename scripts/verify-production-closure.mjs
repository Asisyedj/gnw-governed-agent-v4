import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const required=[
  "package.json","package-lock.json",
  "drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql",
  "docs/PRODUCTION_CLOSURE.md",
  "src/server/db/schema.ts","src/server/db/index.ts",
  "src/server/governance.ts","src/server/action-envelope.ts",
  "src/server/execution.ts","src/server/audit.ts","src/server/invariants.ts",
  "src/server/lib/secretsCheck.ts","src/server/llm.ts","src/server/storage.ts","src/server/verified-data.ts","src/tests/unit/verified-data.test.ts",
  "scripts/migrate.mjs","scripts/test-rls.mjs","src/server/metrics.ts","docs/RUNTIME_EXECUTION_POLICY.md"
];

const failures=[];
for(const file of required){
  if(!existsSync(file)) failures.push(`missing:${file}`);
}

const read=file=>existsSync(file)?readFileSync(file,"utf8"):"";
const pkg=read("package.json");
if(!/\"build\"\s*:\s*\"npm run build:server && npm run build:client\"/.test(pkg)) failures.push("package:build-script-missing");
if(!/node_modules/.test(read("package-lock.json"))) failures.push("lockfile:invalid-or-empty");

const schema=read("src/server/db/schema.ts");
if(!schema.includes('from "drizzle-orm/pg-core"')) failures.push("schema:not-postgresql");
if(schema.includes("sqliteTable(")) failures.push("schema:sqlite-runtime-mismatch");
for(const token of ["users_id_tenant_uq","tasks_id_tenant_uq","task_steps_id_tenant_uq","sessions_user_same_tenant_fk","tasks_creator_same_tenant_fk","task_steps_task_same_tenant_fk","approvals_task_same_tenant_fk","budget_task_same_tenant_fk","artifacts_task_same_tenant_fk","capability_task_same_tenant_fk","capability_actor_same_tenant_fk"]){
  if(!schema.includes(token)) failures.push(`schema:tenant-integrity-missing:${token}`);
}

const db=read("src/server/db/index.ts");
if(!db.includes("set_config('app.tenant_id'")) failures.push("db:tenant-context-missing");
if(!/\.transaction\(async tx/.test(db)) failures.push("db:tenant-context-not-transactional");

const exec=read("src/server/execution.ts");
if(!exec.includes("governance.authorize")) failures.push("execution:governance-not-enforced");
const authzIndex=exec.indexOf("governance.authorize");
const handlerIndex=exec.indexOf("const output=await handler(");
if(authzIndex<0||handlerIndex<0||authzIndex>handlerIndex) failures.push("execution:handler-before-governance");
if(!exec.includes("persistCapabilityLease")) failures.push("execution:capability-lease-persistence-missing");
if(!exec.includes("consumeCapabilityLease")) failures.push("execution:capability-lease-consumption-missing");
if(!exec.includes("governance_digest_mismatch")) failures.push("execution:envelope-governance-binding-missing");

const audit=read("src/server/audit.ts");
if(!audit.includes("setInterlock")) failures.push("audit:required-write-does-not-trip-interlock");
if(!read("drizzle/0002_governance_hardening.sql").includes("audit_log_append_only")) failures.push("audit:append-only-trigger-missing");

const policy=read("docs/RUNTIME_EXECUTION_POLICY.md");
if(!policy.includes("GNW-REP-1.0")) failures.push("policy:runtime-policy-version-missing");
if(!policy.includes("BuildEvidence.v3")) failures.push("policy:evidence-schema-missing");
if(!policy.includes("OWASP GenAI LLM Top 10 2026")) failures.push("policy:owasp-2026-baseline-missing");
if(!policy.includes("Agent Control Standard")) failures.push("policy:acs-baseline-missing");
if(!policy.includes("gpt-5.6-sol")) failures.push("policy:deep-research-model-baseline-missing");

const llm=read("src/server/llm.ts");
if(!llm.includes("governedFetch")||!llm.includes("assertEgressUrl")) failures.push("llm:production-egress-not-governed");

const secrets=read("src/server/lib/secretsCheck.ts");
for(const token of ["SESSION_SECRET","EXECUTOR_SECRET","GNW_REQUIRE_SIGNED_GRANTS","GNW_GRANT_PRIVATE_KEY_PEM","GNW_GRANT_PUBLIC_KEY_PEM","GNW_LEASE_PRIVATE_KEY_PEM","GNW_EGRESS_ALLOW_LIST"]){
  if(!secrets.includes(token)) failures.push(`secrets:production-validation-missing:${token}`);
}

for(const file of ["drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql"]){
  const sql=read(file);
  for(const token of ["ENABLE ROW LEVEL SECURITY","FORCE ROW LEVEL SECURITY","current_setting('app.tenant_id'"]){
    if(!sql.includes(token)) failures.push(`rls:${file}:${token}`);
  }
}

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
    const unpinned=[...text.matchAll(/uses:\s*([^\s]+)@([^\s]+)/g)]
      .filter(m=>!/^([0-9a-f]{40})$/.test(m[2]))
      .map(m=>m[0]);
    if(unpinned.length) failures.push(`workflow:unpinned-actions:${name}:${unpinned.join(",")}`);
  }
}

const ns=read("k8s/namespace.yaml");
for(const token of ["pod-security.kubernetes.io/enforce: restricted","pod-security.kubernetes.io/audit: restricted","pod-security.kubernetes.io/warn: restricted"]){
  if(!ns.includes(token)) failures.push(`k8s:pod-security-label-missing:${token}`);
}
const deployment=read("k8s/deployment.yaml");
for(const token of ["runAsNonRoot: true","readOnlyRootFilesystem: true","allowPrivilegeEscalation: false","drop: [\"ALL\"]","seccompProfile:","emptyDir:","sizeLimit: 128Mi"]){
  if(!deployment.includes(token)) failures.push(`k8s:deployment-hardening-missing:${token}`);
}

try{
  execFileSync("git",["rev-parse","--is-inside-work-tree"],{stdio:"ignore"});
  execFileSync("git",["diff","--check"],{stdio:"ignore"});
}catch{
  failures.push("git:checkout-or-diff-check-unavailable");
}

if(failures.length){
  console.error("GNW production closure: DENY");
  for(const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("GNW production closure: static gate PASS");
