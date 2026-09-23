import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import type { Db } from "./db/index.js";
import { ENV, type Env } from "./env.js";
import { countUsers, createUser, ensurePersonalWorkspace, findUserByEmail, findUserById, markSignedIn, setUserRole } from "./repo.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = hash.split(":");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = await scrypt(password, salt, KEY_LEN);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function signSessionToken(userId: number, sessionId: string, secret: string): string {
  const payload = JSON.stringify({ userId, sessionId, iat: Date.now() });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): { userId: number; sessionId: string; iat: number } | null {
  try {
    const [b64, sig] = token.split(".");
    if (!b64 || !sig) return null;
    const expected = createHmac("sha256", secret).update(b64).digest("base64url");
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(b64, "base64url").toString());
  } catch {
    return null;
  }
}

export function extractSessionToken(req: Request, env: Env): string | null {
  const cookie = (req.cookies as Record<string, string>)?.["gnw_session"];
  if (cookie) return cookie;
  const bearer = req.headers["authorization"];
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7);
  return null;
}

export async function authenticate(
  req: Request,
  db: Db,
  env: Env
): Promise<{ userId: number; sessionId: string } | null> {
  const token = extractSessionToken(req, env);
  if (!token) return null;
  const parsed = verifySessionToken(token, env.sessionSecret);
  if (!parsed) return null;
  const user = await findUserById(db, parsed.userId);
  if (!user || !user.active) return null;
  return { userId: parsed.userId, sessionId: parsed.sessionId };
}

export function setSessionCookie(res: Response, token: string, env: Env) {
  res.cookie("gnw_session", token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.cookieSameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response, env: Env) {
  res.clearCookie("gnw_session", { httpOnly: true, secure: env.isProduction, sameSite: env.cookieSameSite, path: "/" });
}

export async function bootstrapOwner(db: Db, env: Env): Promise<void> {
  if (!env.ownerEmail || !env.ownerPassword) return;
  const existing = await findUserByEmail(db, env.ownerEmail);
  if (existing) {
    if (existing.role !== "owner") await setUserRole(db, existing.id, "owner");
    return;
  }
  const hashed = await hashPassword(env.ownerPassword);
  const user = await createUser(db, env.ownerEmail, hashed, "owner");
  await ensurePersonalWorkspace(db, user.id);
}
