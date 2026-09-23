import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import {
  findTenantBySlug, createTenant,
  findUserByEmail, createUser, updateUserLastLogin, countUsersByTenant,
  createSession, findSessionByTokenHash, deleteSession,
  insertAuditLog,
} from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SALT_ROUNDS = 12;
const DEFAULT_TENANT_SLUG = "default";
const ALLOW_SELF_REGISTRATION = process.env.ALLOW_SELF_REGISTRATION === "true";
const MAX_USERS_PER_TENANT = 50;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function setCookieToken(reply: Parameters<FastifyPluginAsync>[0]["addHook"] extends never ? never : unknown, token: string) {
  (reply as { setCookie: (n: string, v: string, o: unknown) => void }).setCookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const registerSchema = z.object({ email: z.string().email(), password: z.string().min(12) });

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Bootstrap check — exposed as a helper for the client
  app.get("/bootstrap", async (_req, reply) => {
    const tenant = await findTenantBySlug(app.db, DEFAULT_TENANT_SLUG);
    if (!tenant) return reply.send({ bootstrap: true, allowSelfRegistration: true });
    const count = await countUsersByTenant(app.db, tenant.id);
    return reply.send({ bootstrap: count === 0, allowSelfRegistration: ALLOW_SELF_REGISTRATION });
  });

  // Register
  app.post("/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid input", code: "invalid_input" });
    const { email, password } = parsed.data;

    let tenant = await findTenantBySlug(app.db, DEFAULT_TENANT_SLUG);
    if (!tenant) tenant = await createTenant(app.db, DEFAULT_TENANT_SLUG, "Default Workspace");

    const count = await countUsersByTenant(app.db, tenant.id);
    const isBootstrap = count === 0;

    if (!isBootstrap && !ALLOW_SELF_REGISTRATION) {
      return reply.status(403).send({ error: "Self-registration is disabled.", code: "registration_closed" });
    }
    if (count >= MAX_USERS_PER_TENANT) {
      return reply.status(403).send({ error: "Workspace user limit reached.", code: "limit_reached" });
    }

    const existing = await findUserByEmail(app.db, tenant.id, email);
    if (existing) return reply.status(409).send({ error: "Email already registered.", code: "email_taken" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const role = isBootstrap ? "owner" : "viewer";
    const user = await createUser(app.db, { tenantId: tenant.id, email, passwordHash, role });

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await createSession(app.db, user.id, tenant.id, tokenHash, expiresAt);
    setCookieToken(reply, token);

    await insertAuditLog(app.db, { eventType: "user.register", actorId: user.id, tenantId: tenant.id, outcome: "success", ipAddress: req.ip });
    return reply.status(201).send({ ok: true });
  });

  // Login
  app.post("/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid input", code: "invalid_input" });
    const { email, password } = parsed.data;

    const tenant = await findTenantBySlug(app.db, DEFAULT_TENANT_SLUG);
    if (!tenant) return reply.status(401).send({ error: "Invalid credentials.", code: "invalid_credentials" });

    const user = await findUserByEmail(app.db, tenant.id, email);
    if (!user) {
      await bcrypt.hash(password, SALT_ROUNDS); // timing-safe
      return reply.status(401).send({ error: "Invalid credentials.", code: "invalid_credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await insertAuditLog(app.db, { eventType: "user.login_failed", actorId: user.id, tenantId: tenant.id, outcome: "failure", ipAddress: req.ip });
      return reply.status(401).send({ error: "Invalid credentials.", code: "invalid_credentials" });
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await createSession(app.db, user.id, tenant.id, tokenHash, expiresAt);
    await updateUserLastLogin(app.db, user.id);
    setCookieToken(reply, token);

    await insertAuditLog(app.db, { eventType: "user.login", actorId: user.id, tenantId: tenant.id, outcome: "success", ipAddress: req.ip });
    return reply.send({ ok: true });
  });

  // Logout
  app.post("/logout", async (req, reply) => {
    const token = (req.cookies as Record<string, string>)["session"];
    if (token) {
      const tokenHash = hashToken(token);
      const session = await findSessionByTokenHash(app.db, tokenHash);
      if (session) {
        await deleteSession(app.db, session.id);
        await insertAuditLog(app.db, { eventType: "user.logout", actorId: session.userId, tenantId: session.tenantId, outcome: "success", ipAddress: req.ip });
      }
    }
    reply.clearCookie("session", { path: "/" });
    return reply.send({ ok: true });
  });
};

// Session resolution helper used by other routes
export async function resolveSession(db: Db, cookies: Record<string, string>) {
  const token = cookies["session"];
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await findSessionByTokenHash(db, tokenHash);
  if (!session) return null;
  if (session.expiresAt < new Date()) { await deleteSession(db, session.id); return null; }
  return session;
}
