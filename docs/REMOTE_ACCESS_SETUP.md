# GNW Custom MCP Remote Access

This is the first implementation slice for a **GNW-owned** remote agent and MCP endpoint. It is not a desktop-automation plugin and it does not expose a general-purpose shell.

## Security model

- The public GNW application exposes the OAuth authorization server, protected-resource metadata, and POST /mcp endpoint on one canonical HTTPS origin.
- ChatGPT authenticates as an OAuth public client with authorization code + PKCE S256. Access/refresh tokens and authorization codes are opaque, high-entropy values; only SHA-256 digests are persisted.
- OAuth access tokens are bound to an exact MCP resource audience, tenant, user, client and set of scopes. Access tokens expire after 10 minutes. Refresh tokens rotate and family reuse revokes the family.
- The Android/Termux agent makes **outbound HTTPS requests only**. It has a separate device bearer credential whose hash is stored in GNW. It never opens an inbound listener.
- The agent only accepts operation identifiers in a fixed allowlist. No remote shell, arbitrary executable, command string, working-directory override, or environment-variable assignment is accepted from MCP arguments.
- Read-only status/root listing/file reads have bounded outputs and project-path allowlists. Git commands, npm validation/build commands, and file changes require the gnw:propose scope plus a separate GNW owner/admin approval tied to the exact action digest.
- File changes are limited to approved project source/docs/scripts/compliance paths and selected public documentation. Environment files, keys, credentials, Git internals, dependency manifests/lockfiles, and dependency directories are denied. The agent creates a local backup and verifies the final SHA-256 after an approved write.
- Agent activity is recorded in ~/.local/state/gnw-remote-agent/audit.jsonl with mode 0600; backups are in the same private state directory.
- GNW's existing kill switch, tenant RLS, task approval records, and append-only audit ledger remain authoritative.

**This code is not production certified until the PR's CI passes, a human approves/merges it under repository rules, a real HTTPS host and production secrets are configured, and live ChatGPT ↔ MCP ↔ Android E2E tests plus independent review pass.**

## 1. Configure the gateway

Use the normal GNW deployment process with a genuine public HTTPS origin. The reverse proxy/load balancer must terminate TLS and preserve the canonical Host header. Do not expose the application as plain HTTP on the public internet.

Set these values in the production secret/configuration manager:

~~~dotenv
GNW_MCP_ENABLED=true
GNW_MCP_PUBLIC_BASE_URL=https://YOUR_GNW_HOST
GNW_MCP_RESOURCE_URL=https://YOUR_GNW_HOST/mcp
~~~

GNW_MCP_PUBLIC_BASE_URL must be an HTTPS origin only; it cannot contain a path, credentials, query or fragment. The resource URL must exactly equal that origin plus /mcp. Startup and production preflight fail closed for an invalid configuration.

Apply migrations using the project's migration role, not the application role:

~~~bash
npm ci
npm run db:migrate
npm run typecheck
npm run lint
npm run verify:production
npm run verify:compliance
npm run verify:crypto
npm test
npm run build
~~~

Do not use the sample domain above as a real deployment target. The GNW MCP endpoints stay disabled by default until a real URL is configured.

## 2. Register an Android host agent

After deployment, sign in to GNW as an owner/admin. In an authenticated session, register one device with POST /api/remote-agents and a JSON body such as {"label":"android-termux"}. The response includes a one-time token; it is not returned again. The endpoint is session-authenticated and tenant-bound. Store the token only on that Android device. Never place it in Git, project files, screenshots, or this ChatGPT conversation.

If calling the API manually, use an existing authenticated GNW session cookie only in your trusted local shell; do not paste the cookie or returned device token into a support chat:

~~~bash
curl --fail-with-body --silent --show-error \
  -X POST "$GNW_BASE_URL/api/remote-agents" \
  -H "Cookie: session=$GNW_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"label":"android-termux"}'
~~~

Copy the returned token immediately to the device's private local configuration. Do not store the raw token in GNW project files. Revoke a device using the owner/admin endpoint DELETE /api/remote-agents/{id} if its token is lost or the device is retired.

## 3. Run the agent in Termux / Ubuntu PRoot

Install Node.js and Git in Termux, then use a GNW checkout containing scripts/gnw-remote-agent.mjs:

~~~bash
pkg update -y
pkg install -y nodejs-lts git tmux
cd "$HOME/gnw-governed-agent-v4"
npm ci
~~~

Create a private environment file outside the repository. Replace the values locally; never commit this file:

~~~bash
mkdir -p "$HOME/.config/gnw-remote-agent"
chmod 700 "$HOME/.config/gnw-remote-agent"
cat > "$HOME/.config/gnw-remote-agent/agent.env" <<'EOF'
GNW_GATEWAY_URL=https://YOUR_GNW_HOST
GNW_WORKSPACE=$HOME/gnw-governed-agent-v4
GNW_AGENT_TOKEN=REPLACE_WITH_ONE_TIME_DEVICE_TOKEN
EOF
chmod 600 "$HOME/.config/gnw-remote-agent/agent.env"
~~~

Then start it in a Termux session:

~~~bash
set -a
. "$HOME/.config/gnw-remote-agent/agent.env"
set +a
termux-wake-lock
node "$GNW_WORKSPACE/scripts/gnw-remote-agent.mjs"
~~~

The agent reconnects with bounded exponential backoff and jitter if the network disappears. Android may still suspend or terminate Termux; a wake lock and tmux improve persistence but do not guarantee uninterrupted 24/7 operation. Test reconnect after Wi-Fi/mobile-data transitions and after restarting the device. To detach a tmux session, start the command inside tmux new -s gnw-agent; reattach with tmux attach -t gnw-agent.

## 4. Connect ChatGPT

In ChatGPT on the web, open the custom app/MCP configuration flow available for the account/workspace. Add the HTTPS MCP endpoint:

~~~text
https://YOUR_GNW_HOST/mcp
~~~

The server advertises:
- /.well-known/oauth-protected-resource
- /.well-known/oauth-authorization-server
- dynamic client registration at /oauth/register
- authorization code + PKCE S256
- resource-bound token endpoint /oauth/token
- the GNW MCP JSON-RPC tools at /mcp

Complete the OAuth flow in ChatGPT with the intended GNW owner/admin account and grant only the scopes needed for the work. gnw:read permits inspection; gnw:propose allows proposals, not immediate writes. A file or command-capable operation is not run until a GNW owner/admin separately approves the exact action through the GNW approval process.

## 5. Initial verification checklist

1. GET /.well-known/oauth-protected-resource reports the exact /mcp resource and your authorization-server origin.
2. ChatGPT OAuth completes with the actual connector callback URI and PKCE S256; do not infer success from metadata alone.
3. gnw_remote_status shows the registered device and a recent heartbeat.
4. gnw_request_safe_check with system_status returns an asynchronous task; poll with gnw_get_task_result.
5. Confirm no command-capable operation can run without gnw_propose_validation and independent approval.
6. Propose a harmless documentation edit, verify it remains pending_approval, confirm the agent does not apply it, then test approval, backup, SHA-256 validation, and the audit entries in a disposable test checkout.
7. Exercise token revocation, refresh-token replay revocation, device revocation, tenant isolation, kill switch, rate limits, failure/reconnect, database RLS and full end-to-end behavior.
8. Capture commit SHA, workflow runs, test artifacts, HTTPS checks, database migration report, approval evidence, deployment ID, rollback evidence and independent review report before evaluating production readiness.

## Current implementation boundary

This initial implementation does not create a cloud hosting project, domain, TLS certificate, DNS record, production secrets, external hardware attestation, MPC trust anchors, independent security review, or live ChatGPT connector. Those require real provisioned infrastructure and evidence. Do not mark the system production-ready solely because unit tests or static gates pass.
