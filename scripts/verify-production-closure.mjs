import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const required=[
  "drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql","docs/PRODUCTION_CLOSURE.md",
  "src/server/db/schema.ts","src/server/db/index.ts","src/server/governance.ts","src/server/action-envelope.ts","src/server/execution.ts","src/server/audit.ts","src/server/invariants.ts"
];
const failures=[];
for(const file of required)if(!existsSync(file))failures.push(`missing:${file}`);

const schema=existsSync("src/server/db/schema.ts")?readFileSync("src/server/db/schema.ts","utf8"):"";
if(!schema.includes('from "drizzle-orm/pg-core"'))failures.push("schema:not-postgresql");
if(schema.includes("sqliteTable("))failures.push("schema:sqlite-runtime-mismatch");
const db=existsSync("src/server/db/index.ts")?readFileSync("src/server/db/index.ts","utf8"):"";
if(!db.includes("set_config('app.tenant_id'"))failures.push("db:tenant-context-missing");
if(!/\.transaction\(async tx/.test(db))failures.push("db:tenant-context-not-transactional");
const exec=existsSync("src/server/execution.ts")?readFileSync("src/server/execution.ts","utf8"):"";
if(!exec.includes("governance.authorize"))failures.push("execution:governance-not-enforced");
if(exec.indexOf("governance.authorize")>exec.indexOf("handler()"))failures.push("execution:handler-before-governance");
for(const file of ["drizzle/0001_production_rls.sql","drizzle/0002_governance_hardening.sql"]){
 if(!existsSync(file))continue;
 const sql=readFileSync(file,"utf8");
 for(const token of ["ENABLE ROW LEVEL SECURITY","FORCE ROW LEVEL SECURITY","current_setting('app.tenant_id'"]){if(!sql.includes(token))failures.push(`rls:${file}:${token}`);}
}
if(existsSync(".github/workflows/ci.yml")){
 const ci=readFileSync(".github/workflows/ci.yml","utf8");
 if(/continue-on-error:\s*true/.test(ci))failures.push("ci:fail-open");
 if(!ci.includes("npm audit --audit-level=high"))failures.push("ci:dependency-audit-missing");
}
try{execFileSync("git",["diff","--check"],{stdio:"inherit"});}catch{failures.push("git:diff-check");}
if(failures.length){console.error("GNW production closure: DENY");for(const failure of failures)console.error(` - ${failure}`);process.exit(1);}
console.log("GNW production closure: static gate PASS");
