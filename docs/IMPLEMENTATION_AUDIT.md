# Source archive and merge constraints

## Archive findings

- `gnw-governed-agent-v4-main.zip` contains application source, package/lock files, tests and migration runner.
- `GNW-Governed-Agent-v4-2026-10-09.zip` contains workflows, deployment configuration, compliance/docs, migrations and compiled `dist`, but lacks the source/package root.
- `GNW-Governed-Agent-v4-Production_2_with_deep_research.zip` was not present under `/mnt/data` during this run, so it could not be audited or merged.

## Migration checksum drift

`scripts/migrate.mjs` stores a SHA-256 checksum by migration filename and rejects content changes after application. The migration SQL files with the same names differ between the source and 2026-10-09 archives. This implementation preserves the existing migration files and adds no same-name replacements. Before deploying, compare the exact checksums in each environment and use a new, reviewed forward-only migration for any schema delta.

## Scope

New checks, mock harness, rollback guards and evidence templates are candidate implementation work. CI and local syntax checks are not proof of live integrations, full end-to-end safety, successful restore/rollback in real staging, or production certification. The production decision must remain HOLD until every required gate has verifiable evidence tied to the exact candidate commit and artifact.
