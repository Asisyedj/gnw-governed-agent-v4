import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../lib/testApp.js";
import { schema, withTenant, type Db } from "../../server/db/index.js";
import { createSession, deleteSession } from "../../server/repo.js";

const BASE_URL = "https://gnw.example.test";
const HOST = "gnw.example.test";
const RESOURCE = BASE_URL + "/mcp";
const ENV_KEYS = ["GNW_MCP_ENABLED", "GNW_MCP_PUBLIC_BASE_URL", "GNW_MCP_RESOURCE_URL"] as const;

let app: FastifyInstance;
let db: Db;
let tenantId = 0;
let userId = 0;
let sessionId = "";
let cookieHeader = "";
let clientId = "";
let registeredAgentToken = "";
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function setMcpEnabled(enabled: boolean) {
  process.env.GNW_MCP_ENABLED = enabled ? "true" : "false";
  process.env.GNW_MCP_PUBLIC_BASE_URL = BASE_URL;
  process.env.GNW_MCP_RESOURCE_URL = RESOURCE;
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function form(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}
function serverHeaders(extra: Record<string, string> = {}) {
  return { host: HOST, ...extra };
}
async function mcpRequest(accessToken: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: serverHeaders({
      authorization: "Bearer " + accessToken,
      accept: "application/json",
      "content-type": "application/json",
    }),
    payload: body,
  });
}
async function callTool(accessToken: string, name: string, args: Record<string, unknown> = {}) {
  const response = await mcpRequest(accessToken, {
    jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.result?.content?.[0]?.type).toBe("text");
  return { response, result: JSON.parse(body.result.content[0].text) as Record<string, unknown> | unknown[] };
}

beforeAll(async () => {
  originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  setMcpEnabled(false);
  ({ app, db } = await createTestApp());

  const [tenant] = await db.insert(schema.tenants).values({
    slug: "mcp-test-" + randomUUID().slice(0, 8),
    displayName: "MCP Remote Access Test",
  }).returning({ id: schema.tenants.id });
  if (!tenant) throw new Error("Unable to create MCP test tenant");
  tenantId = tenant.id;

  const [user] = await withTenant(db, tenantId, tx => tx.insert(schema.users).values({
    tenantId,
    email: "mcp-" + randomUUID() + "@example.test",
    passwordHash: "test-only-hash-not-used-by-this-test",
    role: "owner",
  }).returning({ id: schema.users.id }));
  if (!user) throw new Error("Unable to create MCP test user");
  userId = user.id;

  const rawToken = randomBytes(32).toString("hex");
  const session = await createSession(db, userId, tenantId, sha256(rawToken), new Date(Date.now() + 60 * 60 * 1000));
  sessionId = session.id;
  cookieHeader = "session=" + rawToken;
});

afterAll(async () => {
  try {
    if (clientId) await db.delete(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId));
    if (sessionId && tenantId) await deleteSession(db, sessionId, tenantId);
    if (userId && tenantId) await withTenant(db, tenantId, tx => tx.delete(schema.users).where(eq(schema.users.id, userId)));
    if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await app?.close();
  } finally {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

describe("GNW OAuth-protected MCP gateway", () => {
  it("keeps the MCP endpoint unavailable when explicitly disabled", async () => {
    setMcpEnabled(false);
    const metadata = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: serverHeaders() });
    expect(metadata.statusCode).toBe(404);
    const mcp = await app.inject({
      method: "POST", url: "/mcp", headers: serverHeaders({ "content-type": "application/json" }),
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(mcp.statusCode).toBe(404);
  });

  it("enforces metadata, DCR, OAuth PKCE, scoped MCP tools, and agent approval gates", async () => {
    setMcpEnabled(true);

    const authorizationMetadata = await app.inject({
      method: "GET", url: "/.well-known/oauth-authorization-server", headers: serverHeaders(),
    });
    expect(authorizationMetadata.statusCode).toBe(200);
    expect(authorizationMetadata.json()).toMatchObject({
      authorization_endpoint: BASE_URL + "/oauth/authorize",
      token_endpoint: BASE_URL + "/oauth/token",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });

    const resourceMetadata = await app.inject({
      method: "GET", url: "/.well-known/oauth-protected-resource", headers: serverHeaders(),
    });
    expect(resourceMetadata.statusCode).toBe(200);
    expect(resourceMetadata.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [BASE_URL] });

    const unauthenticated = await app.inject({
      method: "POST", url: "/mcp",
      headers: serverHeaders({ accept: "application/json", "content-type": "application/json" }),
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers["www-authenticate"]).toContain("resource_metadata");

    const invalidDcr = await app.inject({
      method: "POST", url: "/oauth/register",
      headers: serverHeaders({ "content-type": "application/json" }),
      payload: {
        client_name: "Unsafe test client",
        redirect_uris: ["javascript:alert(1)"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    });
    expect(invalidDcr.statusCode).toBe(400);

    const redirectUri = "https://chatgpt.com/connector/oauth/gnw-test";
    const registration = await app.inject({
      method: "POST", url: "/oauth/register",
      headers: serverHeaders({ "content-type": "application/json" }),
      payload: {
        client_name: "GNW MCP integration test",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    });
    expect(registration.statusCode).toBe(201);
    clientId = registration.json().client_id;
    expect(clientId).toMatch(/^gnw_client_/);
    expect(registration.json().client_secret).toBeUndefined();

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = "state-" + randomUUID();
    const authorizeUrl = new URL(BASE_URL + "/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", "gnw:read gnw:propose");
    authorizeUrl.searchParams.set("resource", RESOURCE);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const authorization = await app.inject({
      method: "GET", url: authorizeUrl.pathname + authorizeUrl.search,
      headers: serverHeaders({ cookie: cookieHeader }),
    });
    expect(authorization.statusCode).toBe(200);
    expect(authorization.body).toContain("gnw:read");
    expect(authorization.body).toContain("gnw:propose");
    const interaction = /name="interaction" value="([^"]+)"/.exec(authorization.body)?.[1];
    expect(interaction).toBeTruthy();

    const consent = await app.inject({
      method: "POST", url: "/oauth/consent",
      headers: serverHeaders({
        cookie: cookieHeader,
        origin: BASE_URL,
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      }),
      payload: form({ interaction: interaction!, decision: "approve" }),
    });
    expect(consent.statusCode).toBe(302);
    const redirect = new URL(consent.headers.location!);
    expect(redirect.origin + redirect.pathname).toBe(redirectUri);
    expect(redirect.searchParams.get("state")).toBe(state);
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const badVerifier = (verifier[0] === "A" ? "B" : "A") + verifier.slice(1);
    const badExchange = await app.inject({
      method: "POST", url: "/oauth/token",
      headers: serverHeaders({ "content-type": "application/x-www-form-urlencoded" }),
      payload: form({
        grant_type: "authorization_code", client_id: clientId, code: code!, redirect_uri: redirectUri,
        code_verifier: badVerifier, resource: RESOURCE,
      }),
    });
    expect(badExchange.statusCode).toBe(400);

    const exchange = await app.inject({
      method: "POST", url: "/oauth/token",
      headers: serverHeaders({ "content-type": "application/x-www-form-urlencoded" }),
      payload: form({
        grant_type: "authorization_code", client_id: clientId, code: code!, redirect_uri: redirectUri,
        code_verifier: verifier, resource: RESOURCE,
      }),
    });
    expect(exchange.statusCode).toBe(200);
    const tokens = exchange.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
    expect(tokens.access_token).toMatch(/^gnw_at_/);
    expect(tokens.refresh_token).toMatch(/^gnw_rt_/);
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.scope.split(" ")).toContain("gnw:propose");

    const reusedCode = await app.inject({
      method: "POST", url: "/oauth/token",
      headers: serverHeaders({ "content-type": "application/x-www-form-urlencoded" }),
      payload: form({
        grant_type: "authorization_code", client_id: clientId, code: code!, redirect_uri: redirectUri,
        code_verifier: verifier, resource: RESOURCE,
      }),
    });
    expect(reusedCode.statusCode).toBe(400);

    const initialize = await mcpRequest(tokens.access_token, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } },
    });
    expect(initialize.statusCode).toBe(200);
    expect(initialize.json().result.serverInfo.name).toBe("gnw-governed-remote-access");

    const toolsResponse = await mcpRequest(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(toolsResponse.statusCode).toBe(200);
    const names = (toolsResponse.json().result.tools as Array<{ name: string }>).map(tool => tool.name);
    expect(names).toContain("gnw_remote_status");
    expect(names).toContain("gnw_propose_validation");
    expect(names).toContain("gnw_propose_file_change");

    const agentRegistration = await app.inject({
      method: "POST", url: "/api/remote-agents",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      payload: { label: "test-host-agent" },
    });
    expect(agentRegistration.statusCode).toBe(201);
    registeredAgentToken = agentRegistration.json().token;
    expect(registeredAgentToken).toMatch(/^gnw_agent_/);
    expect(agentRegistration.json().tokenDisplayWarning).toContain("not retrievable later");
    const agentRows = await withTenant(db, tenantId, tx => tx.select().from(schema.remoteAgents).where(eq(schema.remoteAgents.tenantId, tenantId)));
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].tokenHash).toBe(sha256(registeredAgentToken));
    expect(JSON.stringify(agentRows[0])).not.toContain(registeredAgentToken);

    const safeStatus = await callTool(tokens.access_token, "gnw_remote_status");
    expect(Array.isArray(safeStatus.result)).toBe(true);

    const requestedTask = await callTool(tokens.access_token, "gnw_request_safe_check", { operation: "system_status" });
    expect(requestedTask.response.statusCode).toBe(200);
    const task = requestedTask.result as { remoteTaskId: string; status: string };
    expect(task.status).toBe("queued");
    expect(task.remoteTaskId).toMatch(/^[0-9a-f-]{36}$/i);

    const heartbeat = await app.inject({
      method: "POST", url: "/mcp-agent/heartbeat",
      headers: serverHeaders({ authorization: "Bearer " + registeredAgentToken, "content-type": "application/json" }),
      payload: {},
    });
    expect(heartbeat.statusCode).toBe(200);

    const next = await app.inject({
      method: "POST", url: "/mcp-agent/next",
      headers: serverHeaders({ authorization: "Bearer " + registeredAgentToken, "content-type": "application/json" }),
      payload: {},
    });
    expect(next.statusCode).toBe(200);
    const claimed = next.json().task as { id: string; kind: string; actionDigest?: string | null };
    expect(claimed.id).toBe(task.remoteTaskId);
    expect(claimed.kind).toBe("system_status");

    const result = await app.inject({
      method: "POST", url: "/mcp-agent/result",
      headers: serverHeaders({ authorization: "Bearer " + registeredAgentToken, "content-type": "application/json" }),
      payload: { taskId: claimed.id, status: "completed", output: { ok: true, result: { platform: "linux", nodeVersion: "v22.0.0" } } },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ ok: true, status: "completed" });

    const storedResult = await callTool(tokens.access_token, "gnw_get_task_result", { remoteTaskId: task.remoteTaskId });
    expect(storedResult.result).toMatchObject({ status: "completed", output: { ok: true } });

    const validationProposal = await callTool(tokens.access_token, "gnw_propose_validation", {
      operation: "git_status", rationale: "Check the current GNW worktree status for the requested audit.",
    });
    const validation = validationProposal.result as { remoteTaskId: string; approvalId: number; status: string; actionDigest: string };
    expect(validation.status).toBe("pending_approval");
    expect(validation.approvalId).toBeGreaterThan(0);
    expect(validation.actionDigest).toMatch(/^[0-9a-f]{64}$/);

    const fileProposal = await callTool(tokens.access_token, "gnw_propose_file_change", {
      path: "docs/remote-access-test.md",
      content: "# Test proposal\nThis is only a proposed file change.\n",
      rationale: "Exercise the separate human approval path without applying a filesystem mutation.",
    });
    const proposed = fileProposal.result as { remoteTaskId: string; approvalId: number; status: string };
    expect(proposed.status).toBe("pending_approval");
    expect(proposed.approvalId).toBeGreaterThan(0);

    const noUnapprovedDispatch = await app.inject({
      method: "POST", url: "/mcp-agent/next",
      headers: serverHeaders({ authorization: "Bearer " + registeredAgentToken, "content-type": "application/json" }),
      payload: {},
    });
    expect(noUnapprovedDispatch.statusCode).toBe(200);
    expect(noUnapprovedDispatch.json().task).toBeNull();

    const refresh = await app.inject({
      method: "POST", url: "/oauth/token",
      headers: serverHeaders({ "content-type": "application/x-www-form-urlencoded" }),
      payload: form({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource: RESOURCE }),
    });
    expect(refresh.statusCode).toBe(200);
    const rotated = refresh.json() as { access_token: string; refresh_token: string };
    expect(rotated.access_token).not.toBe(tokens.access_token);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    const replay = await app.inject({
      method: "POST", url: "/oauth/token",
      headers: serverHeaders({ "content-type": "application/x-www-form-urlencoded" }),
      payload: form({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource: RESOURCE }),
    });
    expect(replay.statusCode).toBe(400);
  });
});
