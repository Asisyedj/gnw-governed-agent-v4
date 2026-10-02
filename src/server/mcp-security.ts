import type { FastifyRequest } from "fastify";
import { ENV } from "./env.js";

export function isMcpRequestAllowed(req: FastifyRequest): boolean {
  const origin = req.headers.origin ?? "";
  if (!origin) return Boolean(ENV.deepResearchMcpUrl && ENV.deepResearchMcpLabel);
  if (ENV.corsOrigin && origin === ENV.corsOrigin) return true;
  const host = req.headers.host ?? "";
  try {
    const u = new URL(`http://${host}`);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch { /* ignore */ }
  return false;
}
