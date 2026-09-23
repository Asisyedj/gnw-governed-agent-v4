# Runbook: Kill Switch Activation & Recovery

## Purpose
The kill switch immediately suspends ALL governed agent actions across all tenants.  
It is a last-resort safety control — not a maintenance mode.

---

## Activation

### Via API (requires `admin` or `owner` role)
```bash
curl -X POST https://<GNW_HOST>/api/interlock/kill-switch \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{"enabled": true, "reason": "Anomalous agent behaviour detected"}'
```

### Via kubectl (emergency — bypasses API)
```bash
kubectl exec -n gnw deploy/gnw-app -- \
  node -e "require('./dist/server/scripts/killSwitch.js').activate()"
```

---

## What Happens
- All POST/PUT/PATCH/DELETE requests to governed endpoints return **503 kill_switch**.
- Every blocked request is written to `audit_log` with `event_type: kill_switch_block`.
- Health and interlock endpoints remain available.
- Read-only GET requests are NOT blocked.

---

## Recovery

1. **Investigate** — review `audit_log` for the triggering event.
2. **Confirm** with at least two authorized operators that it is safe to re-enable.
3. **Deactivate**:
```bash
curl -X POST https://<GNW_HOST>/api/interlock/kill-switch \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{"enabled": false, "reason": "Investigation complete — safe to resume"}'
```
4. **Verify** — confirm that `killSwitch: false` is returned by `GET /api/interlock`.
5. **Document** the incident in your incident management system.

---

## Escalation
If the API is unreachable, restart the pod with the `FORCE_KILL_SWITCH=true` env var  
or restore the DB row directly:
```sql
UPDATE interlocks SET kill_switch = false, updated_at = now() WHERE id = 1;
```
