/**
 * Typed structured logger helper.
 * Wraps Fastify's pino instance with domain-specific context.
 */
export type LogContext = Record<string, unknown>;

export function sanitize(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  const redacted = ["password", "passwordHash", "token", "tokenHash", "secret", "cookie"];
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
      redacted.some(r => k.toLowerCase().includes(r)) ? [k, "[REDACTED]"] : [k, sanitize(v)]
    )
  );
}
