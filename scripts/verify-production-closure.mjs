import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const required = [
  'drizzle/0001_production_rls.sql',
  'docs/PRODUCTION_CLOSURE.md',
  'src/server/governance.ts',
  'src/server/action-envelope.ts',
  'src/server/audit.ts',
  'src/server/invariants.ts',
];
const failures = [];
for (const file of required) if (!existsSync(file)) failures.push(`missing:${file}`);

if (existsSync('drizzle/0001_production_rls.sql')) {
  const sql = readFileSync('drizzle/0001_production_rls.sql', 'utf8');
  for (const token of ['ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', "current_setting('app.tenant_id'"]) {
    if (!sql.includes(token)) failures.push(`rls:${token}`);
  }
}

if (existsSync('.github/workflows/ci.yml')) {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  if (/npm audit[^\n]*\n\s*continue-on-error:\s*true/.test(ci)) failures.push('ci:npm-audit-fail-open');
}

try { execFileSync('git', ['diff', '--check'], { stdio: 'inherit' }); }
catch { failures.push('git:diff-check'); }

if (failures.length) {
  console.error('GNW production closure: DENY');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('GNW production closure: static gate PASS');
