import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { schema, type Db, type DbTransaction, withTenant } from "../db/index.js";
import { resolveSession } from "./auth.js";
import {
  createSession,
  findTenantBySlug,
  findUserByEmail,
  findUserById,
  insertAuditLog,
  updateUserLastLogin,
} from "../repo.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const {
  oauthClients, oauthAuthorizationInteractions, oauthAuthorizationCodes, oauthAccessTokens,
  oauthRefreshTokens, remoteAgents, remoteTasks, tasks, approvals, users,
} = schema;
const MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const INTERACTION_TTL_MS = 5 * 60 * 1000;
const REMOTE_TASK_TTL_MS = 30 * 60 * 1000;
const REMOTE_TASK_LEASE_MS = 20 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TASK_OUTPUT_BYTES = 900 * 1024;
const SCOPES = new Set(["gnw:read", "gnw:propose"]);
const SAFE_CHECKS = new Set(["system_status", "list_project_root"]);
const APPROVABLE_OPERATIONS = new Set([
  "git_status", "git_diff_check", "current_commit",
  "typecheck", "lint", "production_closure", "compliance", "crypto_closure", "build",
]);

type RemoteKind =
  | "system_status" | "git_status" | "git_diff_check" | "current_commit" | "list_project_root"
  | "typecheck" | "lint" | "production_closure" | "compliance" | "crypto_closure" | "build"
  | "file_read" | "file_change";
type OAuthClient = typeof oauthClients.$inferSelect;
type Caller = { userId: number; tenantId: number; clientId: string; scopes: Set<string>; role: string };
type McpConfig = { baseUrl: string; origin: string; host: string; resource: string };

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function canonicalOperationDigest(operation: string, rationale: string): string {
  // Fixed-order tuple plus a domain separator prevents ambiguous operation/rationale bindings.
  return hash(`GNW-REMOTE-VALIDATION-V1\\0${JSON.stringify([operation, rationale])}`);
}
function b64urlHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}
function safeRandomToken(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}
function getConfig(): McpConfig | null {
  if (process.env.GNW_MCP_ENABLED !== "true") return null;
  try {
    const configuredBase = process.env.GNW_MCP_PUBLIC_BASE_URL ?? "";
    const resource = process.env.GNW_MCP_RESOURCE_URL ?? "";
    if (!configuredBase || !resource) return null;
    const base = new URL(configuredBase);
    const res = new URL(resource);
    if (base.username || base.password || base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) return null;
    if (process.env.NODE_ENV === "production" && base.protocol !== "https:") return null;
    if (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(base.hostname))) return null;
    const origin = base.origin;
    if (resource !== origin + "/mcp" || res.origin !== origin || res.pathname !== "/mcp" || res.search || res.hash || res.username || res.password) return null;
    return { baseUrl: origin, origin, host: base.host, resource };
  } catch {
    return null;
  }
}
function isConfigured(reply: FastifyReply): McpConfig | null {
  const config = getConfig();
  if (!config) {
    reply.code(process.env.GNW_MCP_ENABLED === "true" ? 503 : 404).send({ error: "GNW remote access is not configured." });
    return null;
  }
  return config;
}
function hostIsCanonical(request: FastifyRequest, config: McpConfig): boolean {
  const host = request.headers.host;
  if (host && host.toLowerCase() !== config.host.toLowerCase()) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origin === config.origin || origin === "https://chatgpt.com" || origin === "https://chat.openai.com") return true;
  return false;
}
function browserOriginIsCanonical(request: FastifyRequest, config: McpConfig): boolean {
  return request.headers.origin === config.origin && request.headers["sec-fetch-site"] !== "cross-site";
}
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return replacements[character] ?? character;
  });
}
function json(reply: FastifyReply, value: unknown, status = 200) {
  return reply.code(status).header("Cache-Control", "no-store").header("Pragma", "no-cache").send(value);
}
function oauthMetadata(config: McpConfig) {
  return {
    issuer: config.origin,
    authorization_endpoint: config.origin + "/oauth/authorize",
    token_endpoint: config.origin + "/oauth/token",
    registration_endpoint: config.origin + "/oauth/register",
    revocation_endpoint: config.origin + "/oauth/revoke",
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["gnw:read", "gnw:propose"],
    client_id_metadata_document_supported: false,
  };
}
function protectedResourceMetadata(config: McpConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.origin],
    scopes_supported: ["gnw:read", "gnw:propose"],
    resource_documentation: config.origin + "/api/health",
    bearer_methods_supported: ["header"],
  };
}
async function setLocal(tx: DbTransaction, name: string, value: string): Promise<void> {
  const permitted = new Set([
    "app.tenant_id", "app.oauth_interaction_hash", "app.oauth_code_hash",
    "app.oauth_access_hash", "app.oauth_refresh_hash", "app.remote_agent_token_hash",
  ]);
  if (!permitted.has(name) || !/^[A-Za-z0-9_:-]{1,256}$/.test(value)) throw new Error("invalid_security_context");
  await tx.execute(sql.raw("select set_config('" + name + "', '" + value + "', true)"));
}
function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}
function stringField(object: Record<string, unknown>, key: string, max = 8192): string {
  const value = object[key];
  return typeof value === "string" && value.length <= max ? value : "";
}
function formBody(request: FastifyRequest): Record<string, unknown> {
  return bodyRecord(request.body);
}
function scopeList(scope: string): string[] | null {
  if (!scope || scope.length > 160) return null;
  const parts = scope.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > SCOPES.size || parts.some(item => !SCOPES.has(item)) || new Set(parts).size !== parts.length) return null;
  if (!parts.includes("gnw:read")) return null;
  return parts;
}
function scopeText(scopes: string[]): string {
  return [...scopes].sort().join(" ");
}
function validateRedirectUri(value: string): boolean {
  try {
    if (!value || value.length > 2048 || value.trim() !== value) return false;
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return process.env.NODE_ENV !== "production" && url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}
function validateProjectPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 240 || value.includes("\\") || value.startsWith("/") || value.includes("\0")) return null;
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.startsWith("."))) return null;
  const normalized = segments.join("/");
  const allowedRoot = ["src", "docs", "scripts", "compliance"].some(prefix => normalized.startsWith(prefix + "/"));
  const allowedTopLevel = ["README.md", "SECURITY.md", "CHANGELOG.md"].includes(normalized);
  if (!allowedRoot && !allowedTopLevel) return null;
  const lower = normalized.toLowerCase();
  if (/(^|\/)(node_modules|\.git|\.ssh|credentials?|secrets?)(\/|$)/.test(lower) ||
      /(^|\/)\.env($|\.)/.test(lower) || /\.(pem|key|p12|pfx|crt|cer|db|sqlite)$/i.test(lower) ||
      /package(-lock)?\.json$/i.test(lower) || /secret|credential|private.?key|token/i.test(lower)) return null;
  return normalized;
}
function canonicalFileChangeDigest(path: string, content: string, rationale: string): string {
  return hash(JSON.stringify(["file_change", path, hash(content), rationale]));
}
function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,160})$/.exec(authorization);
  return match?.[1] ?? "";
}
function challenge(config: McpConfig, scope = "gnw:read", error?: string) {
  const extra = error ? " error=\"" + error + "\"" : "";
  return "Bearer resource_metadata=\"" + config.origin + "/.well-known/oauth-protected-resource\"" + extra + " scope=\"" + scope + "\"";
}
function isUserRoleAllowed(role: string): boolean {
  return role === "owner" || role === "admin" || role === "operator";
}
async function resolveCaller(db: Db, request: FastifyRequest, config: McpConfig): Promise<Caller | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = hash(token);
  return db.transaction(async tx => {
    await setLocal(tx, "app.oauth_access_hash", tokenHash);
    const [record] = await tx.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.tokenHash, tokenHash)).limit(1);
    if (!record || record.revokedAt || record.expiresAt <= new Date() || record.resource !== config.resource) return null;
    await setLocal(tx, "app.tenant_id", String(record.tenantId));
    const [user] = await tx.select().from(users).where(and(eq(users.id, record.userId), eq(users.tenantId, record.tenantId))).limit(1);
    if (!user || !user.isActive) return null;
    return { userId: user.id, tenantId: record.tenantId, clientId: record.clientId, scopes: new Set(record.scope.split(/\s+/).filter(Boolean)), role: user.role };
  });
}
async function validateMcpRequest(db: Db, request: FastifyRequest, reply: FastifyReply, config: McpConfig, requiredScope = "gnw:read"): Promise<Caller | null> {
  if (!hostIsCanonical(request, config)) {
    reply.code(421).send({ error: "MCP host/origin rejected." });
    return null;
  }
  const caller = await resolveCaller(db, request, config);
  if (!caller) {
    reply.header("WWW-Authenticate", challenge(config, requiredScope, "invalid_token"));
    reply.code(401).send({ error: "Valid GNW OAuth bearer token required.", code: "unauthenticated" });
    return null;
  }
  if (!caller.scopes.has(requiredScope)) {
    reply.header("WWW-Authenticate", challenge(config, requiredScope, "insufficient_scope"));
    reply.code(403).send({ error: "Required GNW MCP scope is missing.", code: "insufficient_scope" });
    return null;
  }
  return caller;
}
function authCodeRequest(url: URL, config: McpConfig) {
  const responseType = url.searchParams.get("response_type") ?? "";
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const method = url.searchParams.get("code_challenge_method") ?? "";
  const resource = url.searchParams.get("resource") ?? "";
  const requestedScope = url.searchParams.get("scope") ?? "gnw:read";
  const scopes = scopeList(requestedScope);
  if (responseType !== "code" || !clientId || clientId.length > 200 || !validateRedirectUri(redirectUri) ||
      state.length < 8 || state.length > 512 || method !== "S256" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) || resource !== config.resource || !scopes) return null;
  return { clientId, redirectUri, state, codeChallenge, scope: scopeText(scopes), resource, scopes };
}
function returnToPath(value: string, config: McpConfig): string | null {
  if (!value || value.length > 4096 || !value.startsWith("/oauth/authorize?") || value.startsWith("//") || value.includes("\\") || value.includes("\0")) return null;
  try {
    const url = new URL(value, config.origin);
    if (url.origin !== config.origin || url.pathname !== "/oauth/authorize") return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
function loginHtml(returnTo: string, message = ""): string {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Sign in to GNW</title></head><body><main><h1>Sign in to GNW</h1><p>Sign in to review this GNW remote-access request.</p>" +
    (message ? "<p role=\"alert\">" + htmlEscape(message) + "</p>" : "") +
    "<form action=\"/oauth/login\" method=\"post\"><label>Email <input type=\"email\" name=\"email\" autocomplete=\"username\" required maxlength=\"254\"></label>" +
    "<label>Password <input type=\"password\" name=\"password\" autocomplete=\"current-password\" required maxlength=\"1024\"></label>" +
    "<label>Workspace slug <input type=\"text\" name=\"tenant_slug\" value=\"default\" maxlength=\"64\" pattern=\"[a-z0-9-]+\"></label>" +
    "<input type=\"hidden\" name=\"return_to\" value=\"" + htmlEscape(returnTo) + "\"><button type=\"submit\">Sign in</button></form></main></body></html>";
}
function consentHtml(clientName: string, scope: string, interactionId: string): string {
  const scopeDescriptions: Record<string, string> = {
    "gnw:read": "Inspect GNW status, safe checks, file contents in approved project paths, and results from this host agent.",
    "gnw:propose": "Propose GNW project file changes. File changes are not applied until a separate GNW owner/admin approves the exact change.",
  };
  const scopeParagraphs = scope.split(/\s+/).map(item => "<li><strong>" + htmlEscape(item) + "</strong> — " + htmlEscape(scopeDescriptions[item] ?? "GNW access") + "</li>").join("");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Authorize GNW access</title></head><body><main><h1>Authorize GNW access</h1><p><strong>" + htmlEscape(clientName) + "</strong> requests access to your GNW workspace.</p><ul>" + scopeParagraphs + "</ul><p>Granting this permission does not bypass GNW approval rules, kill-switches, tenant isolation, or project path restrictions.</p><form action=\"/oauth/consent\" method=\"post\"><input type=\"hidden\" name=\"interaction\" value=\"" + htmlEscape(interactionId) + "\"><button type=\"submit\" name=\"decision\" value=\"approve\">Approve access</button><button type=\"submit\" name=\"decision\" value=\"deny\">Deny</button></form></main></body></html>";
}
async function readClient(db: Db, clientId: string): Promise<OAuthClient | undefined> {
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  return client;
}
function redirectResult(redirectUri: string, state: string, code?: string, error?: string) {
  const target = new URL(redirectUri);
  if (code) target.searchParams.set("code", code);
  if (error) target.searchParams.set("error", error);
  target.searchParams.set("state", state);
  return target.toString();
}
async function insertIssuedTokens(tx: DbTransaction, input: {
  clientId: string; userId: number; tenantId: number; scope: string; resource: string;
  accessToken: string; refreshToken: string; familyId: string; parentTokenHash?: string | null;
}) {
  const now = new Date();
  await tx.insert(oauthAccessTokens).values({
    tokenHash: hash(input.accessToken), familyId: input.familyId, clientId: input.clientId, userId: input.userId, tenantId: input.tenantId,
    scope: input.scope, resource: input.resource, expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS), createdAt: now,
  });
  await tx.insert(oauthRefreshTokens).values({
    tokenHash: hash(input.refreshToken), familyId: input.familyId, parentTokenHash: input.parentTokenHash ?? null,
    clientId: input.clientId, userId: input.userId, tenantId: input.tenantId, scope: input.scope,
    resource: input.resource, expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS), createdAt: now,
  });
}
function tokenResponse(accessToken: string, refreshToken: string, scope: string) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope,
  };
}
async function exchangeAuthorizationCode(db: Db, form: Record<string, unknown>, config: McpConfig) {
  const clientId = stringField(form, "client_id", 200);
  const code = stringField(form, "code", 512);
  const redirectUri = stringField(form, "redirect_uri", 2048);
  const verifier = stringField(form, "code_verifier", 128);
  const resource = stringField(form, "resource", 2048);
  if (!clientId || !code || !redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || resource !== config.resource) return null;
  const client = await readClient(db, clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) return null;
  const codeHash = hash(code);
  const accessToken = safeRandomToken("gnw_at_");
  const refreshToken = safeRandomToken("gnw_rt_");
  const familyId = randomUUID();
  return db.transaction(async tx => {
    await setLocal(tx, "app.oauth_code_hash", codeHash);
    const [record] = await tx.select().from(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.codeHash, codeHash)).limit(1);
    if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource ||
        record.consumedAt || record.expiresAt <= new Date() || b64urlHash(verifier) !== record.codeChallenge) return null;
    await setLocal(tx, "app.tenant_id", String(record.tenantId));
    const [user] = await tx.select().from(users).where(and(eq(users.id, record.userId), eq(users.tenantId, record.tenantId))).limit(1);
    if (!user || !user.isActive) return null;
    const [consumed] = await tx.update(oauthAuthorizationCodes).set({ consumedAt: new Date() })
      .where(and(eq(oauthAuthorizationCodes.codeHash, codeHash), isNull(oauthAuthorizationCodes.consumedAt), gt(oauthAuthorizationCodes.expiresAt, new Date())))
      .returning();
    if (!consumed) return null;
    await insertIssuedTokens(tx, {
      clientId, userId: record.userId, tenantId: record.tenantId, scope: record.scope, resource,
      accessToken, refreshToken, familyId,
    });
    return { response: tokenResponse(accessToken, refreshToken, record.scope), userId: record.userId, tenantId: record.tenantId };
  });
}
async function exchangeRefreshToken(db: Db, form: Record<string, unknown>, config: McpConfig) {
  const clientId = stringField(form, "client_id", 200);
  const rawRefresh = stringField(form, "refresh_token", 512);
  const resource = stringField(form, "resource", 2048);
  if (!clientId || !rawRefresh || resource !== config.resource) return null;
  const client = await readClient(db, clientId);
  if (!client) return null;
  const tokenHash = hash(rawRefresh);
  const accessToken = safeRandomToken("gnw_at_");
  const refreshToken = safeRandomToken("gnw_rt_");
  const result = await db.transaction(async tx => {
    await setLocal(tx, "app.oauth_refresh_hash", tokenHash);
    const [record] = await tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash)).limit(1);
    if (!record || record.clientId !== clientId || record.resource !== resource || record.expiresAt <= new Date() || record.revokedAt) return null;
    await setLocal(tx, "app.tenant_id", String(record.tenantId));
    if (record.consumedAt) {
      await tx.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(and(eq(oauthRefreshTokens.familyId, record.familyId), eq(oauthRefreshTokens.tenantId, record.tenantId), isNull(oauthRefreshTokens.revokedAt)));
      await tx.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(and(eq(oauthAccessTokens.familyId, record.familyId), eq(oauthAccessTokens.tenantId, record.tenantId), isNull(oauthAccessTokens.revokedAt)));
      return { replay: true as const };
    }
    const [consumed] = await tx.update(oauthRefreshTokens).set({ consumedAt: new Date() })
      .where(and(eq(oauthRefreshTokens.tokenHash, tokenHash), isNull(oauthRefreshTokens.consumedAt), isNull(oauthRefreshTokens.revokedAt), gt(oauthRefreshTokens.expiresAt, new Date())))
      .returning();
    if (!consumed) {
      await tx.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(and(eq(oauthRefreshTokens.familyId, record.familyId), eq(oauthRefreshTokens.tenantId, record.tenantId), isNull(oauthRefreshTokens.revokedAt)));
      await tx.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(and(eq(oauthAccessTokens.familyId, record.familyId), eq(oauthAccessTokens.tenantId, record.tenantId), isNull(oauthAccessTokens.revokedAt)));
      return { replay: true as const };
    }
    const [user] = await tx.select().from(users).where(and(eq(users.id, record.userId), eq(users.tenantId, record.tenantId))).limit(1);
    if (!user || !user.isActive) {
      await tx.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(and(eq(oauthRefreshTokens.familyId, record.familyId), eq(oauthRefreshTokens.tenantId, record.tenantId), isNull(oauthRefreshTokens.revokedAt)));
      await tx.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(and(eq(oauthAccessTokens.familyId, record.familyId), eq(oauthAccessTokens.tenantId, record.tenantId), isNull(oauthAccessTokens.revokedAt)));
      return null;
    }
    await insertIssuedTokens(tx, {
      clientId, userId: record.userId, tenantId: record.tenantId, scope: record.scope, resource,
      accessToken, refreshToken, familyId: record.familyId, parentTokenHash: tokenHash,
    });
    return { replay: false as const, response: tokenResponse(accessToken, refreshToken, record.scope), userId: record.userId, tenantId: record.tenantId };
  });
  if (result?.replay) {
    await insertAuditLog(db, { eventType: "mcp.oauth.refresh_reuse_denied", outcome: "denied", detail: { clientId, familyIdHash: "redacted" } });
    return null;
  }
  return result;
}
async function revokeToken(db: Db, form: Record<string, unknown>) {
  const rawToken = stringField(form, "token", 512);
  const clientId = stringField(form, "client_id", 200);
  if (!rawToken || !clientId) return;
  const tokenHash = hash(rawToken);
  await db.transaction(async tx => {
    await setLocal(tx, "app.oauth_access_hash", tokenHash);
    const [access] = await tx.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.tokenHash, tokenHash)).limit(1);
    if (access && access.clientId === clientId) {
      await setLocal(tx, "app.tenant_id", String(access.tenantId));
      await tx.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(and(eq(oauthAccessTokens.tokenHash, tokenHash), eq(oauthAccessTokens.tenantId, access.tenantId)));
      return;
    }
    await setLocal(tx, "app.oauth_refresh_hash", tokenHash);
    const [refresh] = await tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash)).limit(1);
    if (refresh && refresh.clientId === clientId) {
      await setLocal(tx, "app.tenant_id", String(refresh.tenantId));
      await tx.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(and(eq(oauthRefreshTokens.familyId, refresh.familyId), eq(oauthRefreshTokens.tenantId, refresh.tenantId), isNull(oauthRefreshTokens.revokedAt)));
      await tx.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(and(eq(oauthAccessTokens.familyId, refresh.familyId), eq(oauthAccessTokens.tenantId, refresh.tenantId), isNull(oauthAccessTokens.revokedAt)));
    }
  });
}
async function activeAgent(db: Db, tenantId: number) {
  const rows = await withTenant(db, tenantId, tx => tx.select().from(remoteAgents)
    .where(and(eq(remoteAgents.tenantId, tenantId), isNull(remoteAgents.revokedAt))).orderBy(desc(remoteAgents.lastSeenAt), desc(remoteAgents.createdAt)).limit(1));
  return rows[0];
}
function taskTitle(kind: RemoteKind, args: Record<string, unknown>): string {
  if (kind === "file_change") return "GNW remote file-change proposal: " + String(args.path ?? "project file");
  if (kind === "file_read") return "GNW remote file read: " + String(args.path ?? "project file");
  return "GNW remote validation: " + kind;
}
async function enqueueSafeCheck(db: Db, caller: Caller, kind: RemoteKind, args: Record<string, unknown>) {
  const agent = await activeAgent(db, caller.tenantId);
  if (!agent) throw new Error("remote_agent_not_registered");
  const remoteTaskId = randomUUID();
  const expiresAt = new Date(Date.now() + REMOTE_TASK_TTL_MS);
  const result = await withTenant(db, caller.tenantId, async tx => {
    const [task] = await tx.insert(tasks).values({
      tenantId: caller.tenantId, createdByUserId: caller.userId, title: taskTitle(kind, args),
      description: "Fixed-operation GNW remote task. No arbitrary shell command is accepted.",
      classification: "standard", status: "pending", budgetTokensAllocated: 1000, budgetBytesAllocated: 1048576,
      metadata: { source: "gnw_remote_access", remoteTaskId, kind },
    }).returning();
    const [remoteTask] = await tx.insert(remoteTasks).values({
      id: remoteTaskId, tenantId: caller.tenantId, taskId: task!.id, requestedByUserId: caller.userId,
      agentId: agent.id, kind, argumentsJson: args, status: "queued", expiresAt,
    }).returning();
    return { taskId: task!.id, remoteTaskId: remoteTask!.id, status: remoteTask!.status, expiresAt: remoteTask!.expiresAt };
  });
  await insertAuditLog(db, { eventType: "remote.task.requested", actorId: caller.userId, tenantId: caller.tenantId, taskId: result.taskId, resourceType: "remote_task", resourceId: result.remoteTaskId, outcome: "success", detail: { kind, status: result.status } });
  return result;
}
async function proposeValidation(db: Db, caller: Caller, input: unknown) {
  if (!caller.scopes.has("gnw:propose")) throw new Error("insufficient_scope:gnw:propose");
  if (!isUserRoleAllowed(caller.role)) throw new Error("remote_validation_role_denied");
  const body = bodyRecord(input);
  const operation = typeof body.operation === "string" ? body.operation : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  if (!APPROVABLE_OPERATIONS.has(operation) || rationale.length < 5 || rationale.length > 1000) {
    throw new Error("invalid_validation_proposal");
  }
  const agent = await activeAgent(db, caller.tenantId);
  if (!agent) throw new Error("remote_agent_not_registered");
  const actionDigest = canonicalOperationDigest(operation, rationale);
  const remoteTaskId = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const result = await withTenant(db, caller.tenantId, async tx => {
    const [task] = await tx.insert(tasks).values({
      tenantId: caller.tenantId, createdByUserId: caller.userId,
      title: taskTitle(operation as RemoteKind, { rationale }),
      description: rationale, classification: "sensitive", status: "waiting_approval",
      budgetTokensAllocated: 1000, budgetBytesAllocated: 1048576,
      metadata: { source: "gnw_remote_access", remoteTaskId, kind: operation, actionDigest },
    }).returning();
    const [approval] = await tx.insert(approvals).values({
      tenantId: caller.tenantId, taskId: task!.id, requestedByUserId: caller.userId,
      actionDigest, requestId: remoteTaskId, nonce: randomUUID(), expiresAt,
    }).returning();
    const [remoteTask] = await tx.insert(remoteTasks).values({
      id: remoteTaskId, tenantId: caller.tenantId, taskId: task!.id, requestedByUserId: caller.userId,
      agentId: agent.id, kind: operation as RemoteKind, argumentsJson: { rationale },
      status: "pending_approval", approvalId: approval!.id, actionDigest, expiresAt,
    }).returning();
    return { taskId: task!.id, remoteTaskId: remoteTask!.id, approvalId: approval!.id, status: remoteTask!.status, operation, actionDigest, expiresAt: remoteTask!.expiresAt };
  });
  await insertAuditLog(db, {
    eventType: "remote.validation.proposed", actorId: caller.userId, tenantId: caller.tenantId,
    taskId: result.taskId, resourceType: "remote_task", resourceId: result.remoteTaskId, outcome: "success",
    detail: { operation, actionDigest, approvalId: result.approvalId },
  });
  return result;
}
async function proposeFileChange(db: Db, caller: Caller, input: unknown) {
  if (!caller.scopes.has("gnw:propose")) throw new Error("insufficient_scope:gnw:propose");
  if (!isUserRoleAllowed(caller.role)) throw new Error("remote_write_role_denied");
  const body = bodyRecord(input);
  const path = validateProjectPath(body.path);
  const content = typeof body.content === "string" ? body.content : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  if (!path || !content || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES || rationale.length < 5 || rationale.length > 1000) {
    throw new Error("invalid_file_change_proposal");
  }
  if (content.includes("\0")) throw new Error("invalid_file_change_proposal");
  const actionDigest = canonicalFileChangeDigest(path, content, rationale);
  const agent = await activeAgent(db, caller.tenantId);
  if (!agent) throw new Error("remote_agent_not_registered");
  const remoteTaskId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const result = await withTenant(db, caller.tenantId, async tx => {
    const [task] = await tx.insert(tasks).values({
      tenantId: caller.tenantId, createdByUserId: caller.userId, title: taskTitle("file_change", { path }),
      description: rationale, classification: "sensitive", status: "waiting_approval", budgetTokensAllocated: 1000,
      budgetBytesAllocated: MAX_FILE_BYTES, metadata: { source: "gnw_remote_access", remoteTaskId, kind: "file_change", path, contentSha256: hash(content), actionDigest },
    }).returning();
    const [approval] = await tx.insert(approvals).values({
      tenantId: caller.tenantId, taskId: task!.id, requestedByUserId: caller.userId,
      actionDigest, requestId: remoteTaskId, nonce: randomUUID(), expiresAt,
    }).returning();
    const [remoteTask] = await tx.insert(remoteTasks).values({
      id: remoteTaskId, tenantId: caller.tenantId, taskId: task!.id, requestedByUserId: caller.userId,
      agentId: agent.id, kind: "file_change",
      argumentsJson: { path, content, rationale, contentSha256: hash(content) },
      status: "pending_approval", approvalId: approval!.id, actionDigest, expiresAt,
    }).returning();
    return { taskId: task!.id, remoteTaskId: remoteTask!.id, approvalId: approval!.id, status: remoteTask!.status, actionDigest, expiresAt: remoteTask!.expiresAt };
  });
  await insertAuditLog(db, { eventType: "remote.file_change.proposed", actorId: caller.userId, tenantId: caller.tenantId, taskId: result.taskId, resourceType: "remote_task", resourceId: result.remoteTaskId, outcome: "success", detail: { path, contentSha256: hash(content), actionDigest, approvalId: result.approvalId } });
  return result;
}
async function getRemoteTaskResult(db: Db, caller: Caller, taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error("invalid_remote_task_id");
  const rows = await withTenant(db, caller.tenantId, tx => tx.select().from(remoteTasks)
    .where(and(eq(remoteTasks.id, taskId), eq(remoteTasks.tenantId, caller.tenantId))).limit(1));
  const row = rows[0];
  if (!row) throw new Error("remote_task_not_found");
  if (row.requestedByUserId !== caller.userId && caller.role !== "owner" && caller.role !== "admin") throw new Error("remote_task_forbidden");
  return {
    remoteTaskId: row.id, taskId: row.taskId, kind: row.kind, status: row.status, actionDigest: row.actionDigest,
    output: row.output, error: row.errorSummary, createdAt: row.createdAt, startedAt: row.startedAt, completedAt: row.completedAt,
    expiresAt: row.expiresAt, approvalId: row.approvalId,
  };
}
function mcpTools(scopes: Set<string>) {
  const tools: Array<Record<string, unknown>> = [
    { name: "gnw_remote_status", description: "Show registered GNW host agents and their last heartbeat. Does not execute a host operation.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: "gnw_request_safe_check", description: "Queue one read-only GNW host inspection operation. No shell or package command is launched by this tool. The result is asynchronous; retrieve it with gnw_get_task_result.", inputSchema: { type: "object", properties: { operation: { type: "string", enum: [...SAFE_CHECKS] } }, required: ["operation"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: "gnw_read_project_file", description: "Read one text file within the GNW source/docs/scripts/compliance allowlist. Credentials, environment files, private keys, and dependency lock/manifests are blocked.", inputSchema: { type: "object", properties: { path: { type: "string", maxLength: 240 } }, required: ["path"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: "gnw_get_task_result", description: "Read the state and bounded output for a GNW remote task requested by this account.", inputSchema: { type: "object", properties: { remoteTaskId: { type: "string", maxLength: 36 } }, required: ["remoteTaskId"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  ];
  if (scopes.has("gnw:propose")) tools.push({
    name: "gnw_propose_validation",
    description: "Request a fixed Git/npm GNW validation operation. This operation is never run immediately: a separate GNW owner/admin must approve the exact action digest before the host agent executes it.",
    inputSchema: { type: "object", properties: { operation: { type: "string", enum: [...APPROVABLE_OPERATIONS] }, rationale: { type: "string", minLength: 5, maxLength: 1000 } }, required: ["operation", "rationale"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, {
    name: "gnw_propose_file_change",
    description: "Create a proposed GNW source/documentation change. This never writes immediately: a separate GNW owner/admin must approve the exact digest before the host agent applies it. High-impact deployment, policy, migration, workflow, dependency, and secret files are excluded.",
    inputSchema: { type: "object", properties: { path: { type: "string", maxLength: 240 }, content: { type: "string", maxLength: MAX_FILE_BYTES }, rationale: { type: "string", minLength: 5, maxLength: 1000 } }, required: ["path", "content", "rationale"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  });
  return tools;
}
function mcpResult(data: unknown, isError = false) {
  const serialized = JSON.stringify(data, null, 2);
  const bounded = serialized.length > 48000 ? serialized.slice(0, 48000) + "\n[truncated; request narrower evidence]" : serialized;
  return { content: [{ type: "text", text: bounded }], isError };
}
async function toolCall(db: Db, caller: Caller, name: string, args: unknown) {
  if (name === "gnw_remote_status") {
    const rows = await withTenant(db, caller.tenantId, tx => tx.select().from(remoteAgents)
      .where(and(eq(remoteAgents.tenantId, caller.tenantId), isNull(remoteAgents.revokedAt))).orderBy(desc(remoteAgents.lastSeenAt), desc(remoteAgents.createdAt)).limit(20));
    const now = Date.now();
    return rows.map(row => ({
      agentId: row.id, label: row.label, connected: row.lastSeenAt ? now - row.lastSeenAt.getTime() < 90000 : false,
      lastSeenAt: row.lastSeenAt, revoked: Boolean(row.revokedAt), createdAt: row.createdAt,
    }));
  }
  if (name === "gnw_request_safe_check") {
    const body = bodyRecord(args);
    const operation = typeof body.operation === "string" ? body.operation : "";
    if (!SAFE_CHECKS.has(operation)) throw new Error("unsupported_remote_operation");
    return enqueueSafeCheck(db, caller, operation as RemoteKind, {});
  }
  if (name === "gnw_read_project_file") {
    const body = bodyRecord(args);
    const path = validateProjectPath(body.path);
    if (!path) throw new Error("project_file_path_denied");
    return enqueueSafeCheck(db, caller, "file_read", { path });
  }
  if (name === "gnw_get_task_result") {
    const body = bodyRecord(args);
    return getRemoteTaskResult(db, caller, typeof body.remoteTaskId === "string" ? body.remoteTaskId : "");
  }
  if (name === "gnw_propose_validation") return proposeValidation(db, caller, args);
  if (name === "gnw_propose_file_change") return proposeFileChange(db, caller, args);
  throw new Error("unknown_remote_tool");
}
async function authenticateAgent(db: Db, request: FastifyRequest): Promise<{ id: string; tenantId: number; ownerUserId: number } | null> {
  const token = bearerToken(request);
  if (!token.startsWith("gnw_agent_")) return null;
  const tokenHash = hash(token);
  return db.transaction(async tx => {
    await setLocal(tx, "app.remote_agent_token_hash", tokenHash);
    const [row] = await tx.select().from(remoteAgents).where(eq(remoteAgents.tokenHash, tokenHash)).limit(1);
    if (!row || row.revokedAt) return null;
    await setLocal(tx, "app.tenant_id", String(row.tenantId));
    const [user] = await tx.select().from(users).where(and(eq(users.id, row.ownerUserId), eq(users.tenantId, row.tenantId))).limit(1);
    if (!user || !user.isActive) return null;
    await tx.update(remoteAgents).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(and(eq(remoteAgents.id, row.id), eq(remoteAgents.tenantId, row.tenantId), isNull(remoteAgents.revokedAt)));
    return { id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId };
  });
}
function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function isJsonRpcRequest(body: unknown): body is { jsonrpc: string; id?: string | number; method: string; params?: Record<string, unknown> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return record.jsonrpc === "2.0" && typeof record.method === "string" && record.method.length <= 160 &&
    (record.id === undefined || typeof record.id === "string" || typeof record.id === "number");
}
async function routeMcpMessage(db: Db, requestBody: unknown, caller: Caller) {
  if (!isJsonRpcRequest(requestBody)) return { status: 400, body: mcpError(null, -32600, "Invalid JSON-RPC request.") };
  const request = requestBody;
  const hasId = request.id !== undefined;
  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return { status: 202, body: null };
  if (!hasId) return { status: 202, body: null };
  if (request.method === "ping") return { status: 200, body: { jsonrpc: "2.0", id: request.id, result: {} } };
  if (request.method === "initialize") {
    const requested = typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : MCP_PROTOCOL_VERSION;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : MCP_PROTOCOL_VERSION;
    return {
      status: 200,
      body: { jsonrpc: "2.0", id: request.id, result: {
        protocolVersion, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gnw-governed-remote-access", version: "1.0.0" },
        instructions: "GNW tools are tenant-scoped and governed. Host checks use a fixed allowlist. File writes require independent GNW approval of the exact change digest.",
      } },
    };
  }
  if (request.method === "tools/list") {
    return { status: 200, body: { jsonrpc: "2.0", id: request.id, result: { tools: mcpTools(caller.scopes) } } };
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments ?? {};
    const available = mcpTools(caller.scopes).some(item => item.name === name);
    if (!available) return { status: 200, body: { jsonrpc: "2.0", id: request.id, result: mcpResult({ error: "Tool is unavailable under this OAuth scope or does not exist." }, true) } };
    try {
      const result = await toolCall(db, caller, name, args);
      await insertAuditLog(db, { eventType: "mcp.tool.call", actorId: caller.userId, tenantId: caller.tenantId, resourceType: "mcp_tool", resourceId: name, outcome: "success", detail: { clientId: caller.clientId, name } });
      return { status: 200, body: { jsonrpc: "2.0", id: request.id, result: mcpResult(result) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "remote_tool_failed";
      const safeMessage = message.startsWith("insufficient_scope:") ? "The requested OAuth scope is required." : message.replace(/[^A-Za-z0-9 _.:/-]/g, "").slice(0, 200);
      await insertAuditLog(db, { eventType: "mcp.tool.call_denied", actorId: caller.userId, tenantId: caller.tenantId, resourceType: "mcp_tool", resourceId: name || "unknown", outcome: "denied", detail: { reason: safeMessage, clientId: caller.clientId } });
      return { status: 200, body: { jsonrpc: "2.0", id: request.id, result: mcpResult({ error: safeMessage }, true) } };
    }
  }
  return { status: 200, body: mcpError(request.id, -32601, "Method not found.") };
}

export const remoteAccessRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (request, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); }
    catch (error) { done(error as Error); }
  });

  const configOrReply = (reply: FastifyReply, request?: FastifyRequest): McpConfig | null => {
    const config = isConfigured(reply);
    if (!config) return null;
    if (request && !hostIsCanonical(request, config)) {
      reply.code(421).send({ error: "GNW remote-access host rejected." });
      return null;
    }
    return config;
  };

  app.get("/.well-known/oauth-protected-resource", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    return reply.header("Cache-Control", "public, max-age=300").send(protectedResourceMetadata(config));
  });
  app.get("/.well-known/oauth-authorization-server", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    return reply.header("Cache-Control", "public, max-age=300").send(oauthMetadata(config));
  });

  app.post("/oauth/register", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    const body = bodyRecord(request.body);
    const name = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 160) : "";
    const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
    const responses = Array.isArray(body.response_types) ? body.response_types : ["code"];
    const authMethod = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
    if (!name || redirects.length < 1 || redirects.length > 12 ||
        redirects.some(item => typeof item !== "string" || !validateRedirectUri(item)) ||
        new Set(redirects).size !== redirects.length ||
        grants.some(item => item !== "authorization_code" && item !== "refresh_token") ||
        !grants.includes("authorization_code") || !grants.includes("refresh_token") ||
        responses.length !== 1 || responses[0] !== "code" || authMethod !== "none" || body.client_secret) {
      return json(reply, { error: "invalid_client_metadata" }, 400);
    }
    const clientId = "gnw_client_" + randomBytes(24).toString("base64url");
    try {
      const [client] = await app.db.insert(oauthClients).values({
        clientId, clientName: name, redirectUris: redirects as string[], grantTypes: grants as string[], responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
      }).returning();
      await insertAuditLog(app.db, { eventType: "mcp.oauth.client_registered", outcome: "success", resourceType: "oauth_client", resourceId: clientId, detail: { name, redirectCount: redirects.length } });
      return json(reply, {
        client_id: client!.clientId, client_name: client!.clientName, redirect_uris: client!.redirectUris,
        grant_types: client!.grantTypes, response_types: client!.responseTypes,
        token_endpoint_auth_method: "none", client_id_issued_at: Math.floor(client!.createdAt.getTime() / 1000),
      }, 201);
    } catch {
      return json(reply, { error: "client_registration_failed" }, 500);
    }
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    const url = new URL(request.url, config.origin);
    const parameters = authCodeRequest(url, config);
    if (!parameters) return reply.code(400).type("text/html; charset=utf-8").send("<!doctype html><html><body><h1>Invalid authorization request</h1><p>Check the OAuth client, redirect URI, resource, scope and PKCE parameters.</p></body></html>");
    const client = await readClient(app.db, parameters.clientId);
    if (!client || !client.redirectUris.includes(parameters.redirectUri)) return reply.code(400).type("text/html; charset=utf-8").send("<!doctype html><html><body><h1>Unregistered OAuth client or redirect URI</h1></body></html>");
    const returnTo = url.pathname + url.search;
    const session = await resolveSession(app.db, (request.cookies ?? {}) as Record<string, string>);
    if (!session) return reply.type("text/html; charset=utf-8").send(loginHtml(returnTo));
    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user || !user.isActive) {
      reply.clearCookie("session", { path: "/" });
      return reply.type("text/html; charset=utf-8").send(loginHtml(returnTo, "Your session is no longer active. Please sign in again."));
    }
    if (parameters.scopes.includes("gnw:propose") && !isUserRoleAllowed(user.role)) {
      return reply.code(403).type("text/html; charset=utf-8").send("<!doctype html><html><body><h1>Insufficient GNW role</h1><p>Proposal scope requires owner, admin or operator authorization.</p></body></html>");
    }
    const interactionId = safeRandomToken("gnw_interaction_");
    const interactionHash = hash(interactionId);
    const expiresAt = new Date(Date.now() + INTERACTION_TTL_MS);
    await withTenant(app.db, session.tenantId, tx => tx.insert(oauthAuthorizationInteractions).values({
      interactionHash, clientId: parameters.clientId, redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, scope: parameters.scope, resource: parameters.resource,
      userId: session.userId, tenantId: session.tenantId, expiresAt,
    }).then(() => undefined));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(consentHtml(client.clientName, parameters.scope, interactionId));
  });

  app.post("/oauth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    if (!browserOriginIsCanonical(request, config)) return reply.code(403).send({ error: "cross_origin_login_denied" });
    const form = formBody(request);
    const email = stringField(form, "email", 254).trim().toLowerCase();
    const password = stringField(form, "password", 1024);
    const tenantSlug = stringField(form, "tenant_slug", 64) || "default";
    const returnTo = returnToPath(stringField(form, "return_to", 4096), config);
    if (!returnTo || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenantSlug)) return reply.code(400).send({ error: "invalid_login_request" });
    const tenant = await findTenantBySlug(app.db, tenantSlug);
    if (!tenant) {
      await import("bcryptjs").then(async module => { await module.default.hash(password || "constant-time-placeholder", 12); });
      return reply.code(401).type("text/html; charset=utf-8").send(loginHtml(returnTo, "Invalid credentials."));
    }
    const user = await findUserByEmail(app.db, tenant.id, email);
    const bcrypt = await import("bcryptjs");
    if (!user) {
      await bcrypt.default.hash(password || "constant-time-placeholder", 12);
      return reply.code(401).type("text/html; charset=utf-8").send(loginHtml(returnTo, "Invalid credentials."));
    }
    const valid = await bcrypt.default.compare(password, user.passwordHash);
    if (!valid || !user.isActive) {
      await insertAuditLog(app.db, { eventType: "mcp.oauth.login_failed", actorId: user.id, tenantId: tenant.id, outcome: "failure", ipAddress: request.ip });
      return reply.code(401).type("text/html; charset=utf-8").send(loginHtml(returnTo, "Invalid credentials."));
    }
    const rawSession = randomBytes(32).toString("hex");
    await createSession(app.db, user.id, tenant.id, hash(rawSession), new Date(Date.now() + SESSION_TTL_MS));
    await updateUserLastLogin(app.db, user.id, tenant.id);
    reply.setCookie("session", rawSession, { httpOnly: true, secure: config.origin.startsWith("https://"), sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
    await insertAuditLog(app.db, { eventType: "mcp.oauth.login", actorId: user.id, tenantId: tenant.id, outcome: "success", ipAddress: request.ip });
    return reply.code(303).header("Location", returnTo).send();
  });

  app.post("/oauth/consent", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    if (!browserOriginIsCanonical(request, config)) return reply.code(403).send({ error: "cross_origin_consent_denied" });
    const session = await resolveSession(app.db, (request.cookies ?? {}) as Record<string, string>);
    if (!session) return reply.code(401).send({ error: "session_required" });
    const form = formBody(request);
    const interactionId = stringField(form, "interaction", 160);
    const decision = stringField(form, "decision", 20);
    if (!interactionId.startsWith("gnw_interaction_") || !["approve", "deny"].includes(decision)) return reply.code(400).send({ error: "invalid_consent_request" });
    const interactionHash = hash(interactionId);
    const rawCode = safeRandomToken("gnw_code_");
    const codeHash = hash(rawCode);
    const now = new Date();
    const result = await withTenant(app.db, session.tenantId, async tx => {
      const [interaction] = await tx.select().from(oauthAuthorizationInteractions)
        .where(and(eq(oauthAuthorizationInteractions.interactionHash, interactionHash),
          eq(oauthAuthorizationInteractions.userId, session.userId), eq(oauthAuthorizationInteractions.tenantId, session.tenantId)))
        .for("update").limit(1);
      if (!interaction || interaction.expiresAt <= now) return null;
      const [client] = await tx.select().from(oauthClients).where(eq(oauthClients.clientId, interaction.clientId)).limit(1);
      if (!client || !client.redirectUris.includes(interaction.redirectUri)) return null;
      await tx.delete(oauthAuthorizationInteractions).where(eq(oauthAuthorizationInteractions.interactionHash, interactionHash));
      if (decision === "deny") return { denied: true as const, interaction };
      await tx.insert(oauthAuthorizationCodes).values({
        codeHash, clientId: interaction.clientId, redirectUri: interaction.redirectUri, codeChallenge: interaction.codeChallenge,
        scope: interaction.scope, resource: interaction.resource, userId: interaction.userId, tenantId: interaction.tenantId,
        expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
      });
      return { denied: false as const, interaction };
    });
    if (!result) return reply.code(400).send({ error: "authorization_interaction_expired_or_invalid" });
    if (result.denied) {
      await insertAuditLog(app.db, { eventType: "mcp.oauth.consent_denied", actorId: session.userId, tenantId: session.tenantId, outcome: "denied", detail: { clientId: result.interaction.clientId, scope: result.interaction.scope } });
      return reply.code(302).header("Location", redirectResult(result.interaction.redirectUri, result.interaction.state, undefined, "access_denied")).send();
    }
    await insertAuditLog(app.db, { eventType: "mcp.oauth.consent_granted", actorId: session.userId, tenantId: session.tenantId, outcome: "success", detail: { clientId: result.interaction.clientId, scope: result.interaction.scope } });
    return reply.code(302).header("Location", redirectResult(result.interaction.redirectUri, result.interaction.state, rawCode)).send();
  });

  app.post("/oauth/token", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    const contentType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") return json(reply, { error: "invalid_request" }, 400);
    const form = formBody(request);
    if (stringField(form, "client_secret", 1000)) return json(reply, { error: "invalid_client" }, 401);
    const grantType = stringField(form, "grant_type", 100);
    if (grantType === "authorization_code") {
      const exchanged = await exchangeAuthorizationCode(app.db, form, config);
      if (!exchanged) return json(reply, { error: "invalid_grant" }, 400);
      await insertAuditLog(app.db, { eventType: "mcp.oauth.code_exchanged", actorId: exchanged.userId, tenantId: exchanged.tenantId, outcome: "success", detail: { grantType } });
      return json(reply, exchanged.response);
    }
    if (grantType === "refresh_token") {
      const exchanged = await exchangeRefreshToken(app.db, form, config);
      if (!exchanged || exchanged.replay) return json(reply, { error: "invalid_grant" }, 400);
      await insertAuditLog(app.db, { eventType: "mcp.oauth.token_refreshed", actorId: exchanged.userId, tenantId: exchanged.tenantId, outcome: "success", detail: { grantType } });
      return json(reply, exchanged.response);
    }
    return json(reply, { error: "unsupported_grant_type" }, 400);
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    const contentType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") return reply.code(200).send();
    const form = formBody(request);
    if (!stringField(form, "client_id", 200) || !stringField(form, "token", 512)) return reply.code(200).send();
    await revokeToken(app.db, form);
    return reply.code(200).header("Cache-Control", "no-store").send();
  });

  app.post("/mcp", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    const accept = String(request.headers.accept ?? "");
    if (accept && !accept.includes("application/json")) return reply.code(406).send();
    const caller = await validateMcpRequest(app.db, request, reply, config);
    if (!caller) return;
    if (Array.isArray(request.body)) return reply.code(400).send(mcpError(null, -32600, "Batch JSON-RPC requests are not supported."));
    const response = await routeMcpMessage(app.db, request.body, caller);
    if (response.status === 202) return reply.code(202).send();
    return reply.code(response.status).type("application/json").send(response.body);
  });
  app.get("/mcp", async (_request, reply) => reply.code(405).header("Allow", "POST").send());
  app.delete("/mcp", async (_request, reply) => reply.code(405).header("Allow", "POST").send());

  app.post("/api/remote-agents", async (request, reply) => {
    const session = await resolveSession(app.db, (request.cookies ?? {}) as Record<string, string>);
    if (!session) return reply.code(401).send({ error: "unauthenticated" });
    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user || !user.isActive || (user.role !== "owner" && user.role !== "admin")) return reply.code(403).send({ error: "owner_or_admin_required" });
    const body = bodyRecord(request.body);
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 100 || [...label].some(character => character.charCodeAt(0) <= 0x1f)) return reply.code(400).send({ error: "invalid_agent_label" });
    const rawToken = safeRandomToken("gnw_agent_");
    const agentId = randomUUID();
    const [agent] = await withTenant(app.db, session.tenantId, tx => tx.insert(remoteAgents).values({
      id: agentId, tenantId: session.tenantId, ownerUserId: session.userId, label,
      tokenHash: hash(rawToken), createdAt: new Date(), updatedAt: new Date(),
    }).returning());
    await insertAuditLog(app.db, { eventType: "remote.agent.registered", actorId: session.userId, tenantId: session.tenantId, resourceType: "remote_agent", resourceId: agentId, outcome: "success", detail: { label } });
    return reply.code(201).send({
      agentId: agent!.id, label: agent!.label, createdAt: agent!.createdAt,
      token: rawToken, tokenDisplayWarning: "Copy this token now; it is not retrievable later.",
    });
  });
  app.get("/api/remote-agents", async (request, reply) => {
    const session = await resolveSession(app.db, (request.cookies ?? {}) as Record<string, string>);
    if (!session) return reply.code(401).send({ error: "unauthenticated" });
    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user || (user.role !== "owner" && user.role !== "admin")) return reply.code(403).send({ error: "owner_or_admin_required" });
    const rows = await withTenant(app.db, session.tenantId, tx => tx.select().from(remoteAgents).where(eq(remoteAgents.tenantId, session.tenantId)).orderBy(desc(remoteAgents.createdAt)).limit(100));
    return reply.send(rows.map(row => ({ id: row.id, label: row.label, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, revoked: Boolean(row.revokedAt) })));
  });
  app.delete("/api/remote-agents/:id", async (request, reply) => {
    const session = await resolveSession(app.db, (request.cookies ?? {}) as Record<string, string>);
    if (!session) return reply.code(401).send({ error: "unauthenticated" });
    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user || (user.role !== "owner" && user.role !== "admin")) return reply.code(403).send({ error: "owner_or_admin_required" });
    const id = String((request.params as { id?: string }).id ?? "");
    const [agent] = await withTenant(app.db, session.tenantId, tx => tx.update(remoteAgents).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(remoteAgents.id, id), eq(remoteAgents.tenantId, session.tenantId), isNull(remoteAgents.revokedAt))).returning());
    if (!agent) return reply.code(404).send({ error: "remote_agent_not_found" });
    await insertAuditLog(app.db, { eventType: "remote.agent.revoked", actorId: session.userId, tenantId: session.tenantId, resourceType: "remote_agent", resourceId: id, outcome: "success" });
    return reply.send({ ok: true, agentId: id, revoked: true });
  });

  app.post("/mcp-agent/heartbeat", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    if (!hostIsCanonical(request, config)) return reply.code(421).send({ error: "host_rejected" });
    const agent = await authenticateAgent(app.db, request);
    if (!agent) return reply.code(401).send({ error: "agent_authentication_failed" });
    return reply.send({ ok: true, agentId: agent.id, serverTime: new Date().toISOString() });
  });

  app.post("/mcp-agent/next", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    if (!hostIsCanonical(request, config)) return reply.code(421).send({ error: "host_rejected" });
    const agent = await authenticateAgent(app.db, request);
    if (!agent) return reply.code(401).send({ error: "agent_authentication_failed" });
    const result = await withTenant(app.db, agent.tenantId, async tx => {
      const candidates = await tx.select().from(remoteTasks)
        .where(and(eq(remoteTasks.agentId, agent.id), eq(remoteTasks.tenantId, agent.tenantId), inArray(remoteTasks.status, ["queued", "pending_approval"]), gt(remoteTasks.expiresAt, new Date())))
        .orderBy(asc(remoteTasks.createdAt)).limit(20);
      for (const candidate of candidates) {
        if (candidate.status !== "pending_approval" || candidate.approvalId === null) continue;
        const [approval] = await tx.select().from(approvals).where(and(eq(approvals.id, candidate.approvalId), eq(approvals.tenantId, agent.tenantId))).limit(1);
        if (!approval) continue;
        if (approval.status === "approved" && approval.actionDigest === candidate.actionDigest && approval.expiresAt > new Date()) {
          await tx.update(remoteTasks).set({ status: "queued", updatedAt: new Date() }).where(and(eq(remoteTasks.id, candidate.id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.status, "pending_approval")));
          await tx.update(tasks).set({ status: "pending", updatedAt: new Date() }).where(and(eq(tasks.id, candidate.taskId), eq(tasks.tenantId, agent.tenantId)));
        } else if (approval.status === "denied" || approval.expiresAt <= new Date()) {
          await tx.update(remoteTasks).set({ status: approval.expiresAt <= new Date() ? "expired" : "denied", updatedAt: new Date() }).where(and(eq(remoteTasks.id, candidate.id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.status, "pending_approval")));
          await tx.update(tasks).set({ status: "cancelled", errorMessage: "Approval denied or expired.", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.id, candidate.taskId), eq(tasks.tenantId, agent.tenantId)));
        }
      }
      await tx.update(remoteTasks).set({ status: "queued", updatedAt: new Date() })
        .where(and(eq(remoteTasks.agentId, agent.id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.status, "running"), lt(remoteTasks.leaseExpiresAt, new Date()), lt(remoteTasks.attempts, 3)));
      await tx.update(remoteTasks).set({ status: "failed", errorSummary: "Host agent lease expired after the retry limit.", completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(remoteTasks.agentId, agent.id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.status, "running"), lt(remoteTasks.leaseExpiresAt, new Date()), gt(remoteTasks.attempts, 2)));
      const [job] = await tx.select().from(remoteTasks)
        .where(and(eq(remoteTasks.agentId, agent.id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.status, "queued"), gt(remoteTasks.expiresAt, new Date())))
        .orderBy(asc(remoteTasks.createdAt)).for("update", { skipLocked: true }).limit(1);
      if (!job) return null;
      const nextAttempts = job.attempts + 1;
      const now = new Date();
      const [claimed] = await tx.update(remoteTasks).set({ status: "running", attempts: nextAttempts, startedAt: now, leaseExpiresAt: new Date(now.getTime() + REMOTE_TASK_LEASE_MS), updatedAt: now })
        .where(and(eq(remoteTasks.id, job.id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.status, "queued"))).returning();
      if (!claimed) return null;
      await tx.update(tasks).set({ status: "running", startedAt: now, updatedAt: now }).where(and(eq(tasks.id, job.taskId), eq(tasks.tenantId, agent.tenantId)));
      return { id: claimed.id, taskId: claimed.taskId, kind: claimed.kind, arguments: claimed.argumentsJson, actionDigest: claimed.actionDigest, expiresAt: claimed.expiresAt };
    });
    return reply.send({ ok: true, task: result });
  });

  app.post("/mcp-agent/result", async (request, reply) => {
    const config = configOrReply(reply, request);
    if (!config) return;
    if (!hostIsCanonical(request, config)) return reply.code(421).send({ error: "host_rejected" });
    const agent = await authenticateAgent(app.db, request);
    if (!agent) return reply.code(401).send({ error: "agent_authentication_failed" });
    const body = bodyRecord(request.body);
    const id = stringField(body, "taskId", 36);
    const status = stringField(body, "status", 16);
    const output = body.output && typeof body.output === "object" && !Array.isArray(body.output) ? body.output as Record<string, unknown> : {};
    const errorSummary = typeof body.errorSummary === "string" ? body.errorSummary.slice(0, 1000) : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["completed", "failed"].includes(status) ||
        Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_TASK_OUTPUT_BYTES) return reply.code(400).send({ error: "invalid_task_result" });
    const result = await withTenant(app.db, agent.tenantId, async tx => {
      const [job] = await tx.select().from(remoteTasks).where(and(eq(remoteTasks.id, id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.agentId, agent.id))).for("update").limit(1);
      if (!job || job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) return null;
      if (job.kind === "file_change" || APPROVABLE_OPERATIONS.has(job.kind)) {
        if (job.approvalId === null || !job.actionDigest) return null;
        const [approval] = await tx.select().from(approvals).where(and(eq(approvals.id, job.approvalId), eq(approvals.tenantId, agent.tenantId))).limit(1);
        if (!approval || approval.status !== "approved" || approval.actionDigest !== job.actionDigest || approval.expiresAt <= new Date()) return null;
      }
      const now = new Date();
      const [saved] = await tx.update(remoteTasks).set({
        status: status as "completed" | "failed", output, errorSummary: status === "failed" ? (errorSummary || "Remote operation failed.") : null,
        completedAt: now, leaseExpiresAt: null, updatedAt: now,
      }).where(and(eq(remoteTasks.id, id), eq(remoteTasks.tenantId, agent.tenantId), eq(remoteTasks.agentId, agent.id), eq(remoteTasks.status, "running"))).returning();
      if (!saved) return null;
      await tx.update(tasks).set({
        status: status === "completed" ? "done" : "failed", errorMessage: status === "failed" ? (errorSummary || "Remote operation failed.") : null,
        completedAt: now, updatedAt: now,
      }).where(and(eq(tasks.id, job.taskId), eq(tasks.tenantId, agent.tenantId)));
      return { remoteTaskId: saved.id, taskId: saved.taskId, status: saved.status };
    });
    if (!result) return reply.code(409).send({ error: "task_not_running_or_lease_expired" });
    await insertAuditLog(app.db, { eventType: "remote.task.completed", tenantId: agent.tenantId, actorId: agent.ownerUserId, taskId: result.taskId, resourceType: "remote_task", resourceId: result.remoteTaskId, outcome: status === "completed" ? "success" : "failure", detail: { status, kind: "host_operation" } });
    return reply.send({ ok: true, ...result });
  });
};