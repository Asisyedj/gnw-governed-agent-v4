# Runbook: Kill Switch Activation & Recovery

## Purpose

The kill switch suspends governed agent actions. It is a safety control for suspected misuse, compromise, cascading failure or unsafe behavior.

## Activation through API

Requires an authenticated owner/admin session:

~~~bash
curl -X POST "https://<GNW_HOST>/api/interlock/kill-switch" \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{"enabled":true,"reason":"Anomalous agent behaviour detected"}'
~~~

Record the returned interlock generation and preserve the corresponding audit event.

## Emergency activation when the API is unavailable

Use the controlled database administration path. Do not UPDATE or DELETE interlock history.

~~~sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('gnw:interlock-generation'));

INSERT INTO interlocks(kill_switch,circuit_open,generation,reason,updated_by_user_id)
SELECT TRUE,
       TRUE,
       COALESCE(MAX(generation),0) + 1,
       'Emergency kill switch: API unavailable',
       NULL
FROM interlocks;

COMMIT;
~~~

Run this only through the approved DBA emergency procedure with independent authorization. The application runtime role must not have permission to perform this action.

## What happens

- New governed write actions are refused while the kill switch/circuit breaker is engaged.
- Required security events are written to the audit log.
- Health and interlock status remain available so operators can inspect and recover the control plane.
- Existing in-flight work is not retroactively guaranteed to stop; the executor/provider must enforce its own timeout/cancellation boundary.

## Recovery

1. Preserve the triggering evidence and incident timeline.
2. Confirm with the incident commander and a second authorized reviewer that recovery is permitted.
3. Re-enable through the API when available:

~~~bash
curl -X POST "https://<GNW_HOST>/api/interlock/kill-switch" \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{"enabled":false,"reason":"Incident containment complete; resume approved"}'
~~~

4. Verify GET /api/interlock shows the new generation and the intended state.
5. Verify a new capability lease is required after the interlock generation changes.
6. Run the smoke-test/health checks before resuming normal operations.
7. Document the incident and attach audit/runtime evidence.

## Important

Do not use unsupported environment flags or directly UPDATE/DELETE the interlocks table. Interlock state is append-only and generation changes invalidate previously issued capability leases.