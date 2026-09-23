# Runbook: Secret Rotation

## Rotating COOKIE_SECRET

1. Generate new secret:
```bash
openssl rand -hex 32
```

2. Update Kubernetes secret:
```bash
kubectl patch secret gnw-secrets -n gnw \
  --type='json' \
  -p='[{"op":"replace","path":"/data/COOKIE_SECRET","value":"'$(echo -n NEW_VALUE | base64)'"}]'
```

3. Rolling restart (all existing sessions invalidated — users must re-login):
```bash
kubectl rollout restart deployment/gnw-app -n gnw
kubectl rollout status deployment/gnw-app -n gnw
```

4. Verify:
```bash
curl https://<GNW_HOST>/api/health
```

---

## Rotating DATABASE_URL / DB Password

1. Create new DB user/password in PostgreSQL.
2. Grant same permissions as the old user.
3. Update secret and restart (same process as above).
4. Revoke old DB user.
5. Verify connectivity via `/api/ready`.

---

## Notes
- Never commit secrets to Git.
- Rotate after any suspected exposure.
- All rotations should be logged in the incident management system.
