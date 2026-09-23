const REDACT_KEYS = new Set(["password", "secret", "token", "key", "credential", "api_key", "apikey", "authorization"]);

export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(v => redactSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redactSensitive(v, depth + 1);
  }
  return out;
}
