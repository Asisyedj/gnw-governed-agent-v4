import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const required=[
  "drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql","drizzle/0003_governance_evidence.sql","drizzle/0004_interlock_reason.sql","docs/PRODUCTION_CLOSURE.md",
  "src/server/db/schema.ts","src/server/db/index.ts","src/server/governance.ts","src/server/action-envelope.ts","src/server/execution.ts","src/server/audit.ts","src/server/invariants.ts",
  "src/server/governance-contract.ts","src/server/evidence-engine.ts","src/server/justice-framework.ts","src/server/decision-schema.ts","src/server/agent-pipeline.ts","src/server/bias-evaluator.ts","src/server/adversarial.ts","scripts/migrate-sql.mjs",
  "src/tests/unit/governance-contract.test.ts","src/tests/unit/evidence-engine.test.ts","src/tests/unit/justice-framework.test.ts","src/tests/integration/agent-pipeline.test.ts"
];
const failures=[];
for(const file of required)if(!existsSync(file))failures.push("missing:"+file);

const schema=existsSync("src/server/db/schema.ts")?readFileSync("src/server/db/schema.ts","utf8"):"";
for(const token of ["evidenceRecords","governanceReviews","governanceChallenges","governanceDecisions"])if(!schema.includes(token))failures.push("schema:"+token);

const db=existsSync("src/server/db/index.ts")?readFileSync("src/server/db/index.ts","utf8"):"";
if(!db.includes("set_config('app.tenant_id'"))failures.push("db:tenant-context-missing");
if(!/\.transaction\s*\(/.test(db))failures.push("db:tenant-context-not-transactional");

const exec=existsSync("src/server/execution.ts")?readFileSync("src/server/execution.ts","utf8"):"";
if(!exec.includes("governance.authorize"))failures.push("execution:governance-not-enforced");
if(exec.indexOf("governance.authorize")>exec.indexOf("handler()"))failures.push("execution:handler-before-governance");

for(const file of ["drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql","drizzle/0003_governance_evidence.sql"]){
  if(!existsSync(file))continue;
  const sql=readFileSync(file,"utf8");
  for(const token of ["ENABLE ROW LEVEL SECURITY","FORCE ROW LEVEL SECURITY","current_setting('app.tenant_id'"]){
    if(!sql.includes(token))failures.push("rls:"+file+":"+token);
  }
}
const g=readFileSync("src/server/governance-contract.ts","utf8");
for(const token of ["central_governor","research_worker","evidence_auditor","specialist_worker","red_team","bias_auditor","justice_reviewer","final_arbiter"])if(!g.includes(token))failures.push("governance-role:"+token);
const j=readFileSync("src/server/justice-framework.ts","utf8");
for(const token of ["rule_bound_accessible","material_social","impartial_administration","arbitrary_coercion_protection","voice_accountability_correction","equal_civic_standing_group_protection"])if(!j.includes(token))failures.push("justice-dimension:"+token);
const sql3=readFileSync("drizzle/0003_governance_evidence.sql","utf8");
for(const token of ["audit_log_append_only","evidence_append_only","governance_reviews_append_only","governance_challenges_append_only","governance_decisions_append_only"])if(!sql3.includes(token))failures.push("append-only:"+token);

if(existsSync(".github/workflows/ci.yml")){
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  if(/continue-on-error:\s*true/.test(ci))failures.push("ci:fail-open");
  if(!ci.includes("npm audit --audit-level=high"))failures.push("ci:dependency-audit-missing");
  if(!ci.includes("npm run verify:production"))failures.push("ci:closure-gate-missing");
}
try{execFileSync("git",["diff","--check"],{stdio:"inherit"});}catch{failures.push("git:diff-check");}
if(failures.length){console.error("GNW production closure: DENY");for(const f of failures)console.error(" - "+f);process.exit(1);}
console.log("GNW production closure: static gate PASS");