import type { Request } from "express";
import { ENV } from "./env.ts";

export function isMcpRequestAllowed(req: Request): boolean {
  const origin = req.headers.origin ?? "";
  if (!origin) return true; // server-to-server
  if (ENV.corsOrigin && origin === ENV.corsOrigin) return true;
  const host = req.headers.host ?? "";
  try {
    const u = new URL(`http://${host}`);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch { /* ignore */ }
  return false;
}
