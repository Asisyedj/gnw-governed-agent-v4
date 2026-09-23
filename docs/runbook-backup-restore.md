# Runbook: Backup & Restore

## Backup (PostgreSQL 16)

```bash
# Full backup
pg_dump \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  "$DATABASE_URL" \
  > gnw-backup-$(date +%Y%m%d-%H%M%S).dump

# Verify backup integrity
pg_restore --list gnw-backup-*.dump | head -20
```

## Restore

```bash
# Create fresh DB
createdb gnw_restore

# Restore
pg_restore \
  --no-acl \
  --no-owner \
  -d gnw_restore \
  gnw-backup-*.dump

# Verify row counts
psql gnw_restore -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"
```

## Anti-Resurrection Policy
Do NOT restore a backup from a period when a security incident was active.  
Always verify the backup timestamp is **before** the incident window.

## Retention
- Daily backups retained 30 days.
- Weekly backups retained 12 weeks.
- Monthly backups retained 12 months.
