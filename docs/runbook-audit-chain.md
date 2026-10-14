# GNW Audit-Chain Operations Runbook

## Purpose and safety boundary

GNW's audit ledger is a global chain across tenants. A tenant-filtered slice cannot prove the chain is continuous, and an RLS-filtered empty result must never be considered a successful verification.

The global verifier is deliberately owned by `gnw_audit_verifier`, a dedicated **NOLOGIN, NOSUPERUSER, NOBYPASSRLS** role. It receives global visibility through the narrowly scoped `gnw_audit_verifier_global_read` SELECT policy on `public.audit_log`; it does not receive the PostgreSQL `BYPASSRLS` role attribute. Do not grant this verifier role to the application identity.

The function `public.gnw_verify_audit_chain()` is a SECURITY DEFINER function owned by that verifier role. EXECUTE is revoked from PUBLIC. Only explicitly authorized operational identities should be granted access to the verifier function or be allowed to assume the verifier role.

## Provision and migrate

Perform these actions only against the intended environment, with a controlled database-administrator identity and approved maintenance window.

1. Create the application role using `deploy/postgres/10-create-app-role.sh` with `GNW_APP_DB_USER` and `GNW_APP_DB_PASSWORD` set to secret-manager-supplied values. This script provisions `gnw_audit_verifier` as NOLOGIN/NOBYPASSRLS and temporarily grants schema CREATE needed for ownership transfer.
2. Create the canonical `gnw_migrator` identity using `deploy/postgres/11-create-migrator-role.sh`, with `GNW_MIGRATOR_DB_USER=gnw_migrator`. The bootstrap grants temporary membership in `gnw_audit_verifier`; the migrator needs that membership to transfer ownership of the verifier function during migration 0004. The migrator must not be used by the running application.
3. Run `npm run db:migrate` with `DATABASE_URL` set to the migrator connection string and TLS verification enabled for managed/cloud PostgreSQL.
4. Immediately after migrations complete, run `deploy/postgres/20-finalize-audit-verifier.sh` as the controlled database administrator. Set `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and `PGPASSWORD` from approved deployment configuration. The script removes migration-role membership and schema CREATE, revokes PUBLIC EXECUTE, restores the required safe role attributes, and verifies owner/policy/privilege postconditions.
5. Retain the output of the finalizer with the migration logs and exact release SHA. If the finalizer fails, stop promotion and leave the environment on HOLD.

The finalizer intentionally assumes the canonical migration role name `gnw_migrator`. Do not silently rename it without updating the migration bootstrap, finalizer, workflows, and tests together.

## Run verification

Use the committed script:

```sh
DATABASE_URL="$GNW_AUDIT_VERIFY_DATABASE_URL" \
GNW_AUDIT_VERIFY_USE_ROLE=true \
node scripts/verify-audit-chain.mjs --limit 100000
```

For this command, `GNW_AUDIT_VERIFY_DATABASE_URL` must belong to an explicitly authorized operator whose database role has been directly granted membership in `gnw_audit_verifier`. That membership grants the operator the ability to use SET ROLE to read the global audit ledger across tenants. Treat it as a sensitive break-glass/audit permission, grant it only to specifically authorized operators, document the reason, and remove it when no longer required. Do not grant the verifier role to `gnw_app`.

The script fails closed if:
- `--tenant` is supplied (a tenant slice cannot verify the global chain);
- the database verifier function is unavailable or does not return exactly one row;
- the verifier's total differs from the independently read row count;
- row hashes or predecessor links mismatch;
- the requested limit would truncate the chain;
- required append-only privilege checks fail.

A successful local CI verification is not a substitute for a production database verification receipt. Save the output, timestamp, environment/database identifier, operator identity, exact commit SHA, and artifact digest.

## Access and release controls

- `gnw_app`: runtime only; NOBYPASSRLS, no migration authority, no global verifier membership.
- `gnw_migrator`: controlled migration identity; NOBYPASSRLS and NOCREATEDB; its temporary verifier membership is removed by the finalizer.
- `gnw_audit_verifier`: NOLOGIN/NOSUPERUSER/NOBYPASSRLS; SELECT-only visibility to the global audit chain through its dedicated policy; no schema CREATE after finalization.
- Authorized audit operator: explicitly approved direct membership in `gnw_audit_verifier` only when global-chain read access is required.

Any missing policy, unexpected verifier membership, residual schema CREATE, changed function owner, hash mismatch, broken link, visibility mismatch, or failed finalizer is a release-blocking finding. Do not change status to GO because a migration succeeded or a verifier script returned a process exit code without retaining its structured output.
