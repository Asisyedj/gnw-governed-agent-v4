import { createHash, timingSafeEqual } from "node:crypto";

export const CANONICAL_DIGEST_V1 = "GNW-CANONICAL-DIGEST-V1" as const;
export const DIGEST_ALGORITHM = "sha256" as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown, path = "$", seen = new Set<object>()): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new TypeError(`canonical_json_invalid_number:${path}`);
    return value;
  }
  if (value === undefined) throw new TypeError(`canonical_json_undefined:${path}`);
  if (typeof value !== "object") throw new TypeError(`canonical_json_invalid_type:${path}`);
  if (seen.has(value)) throw new TypeError(`canonical_json_cycle:${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, i) => item === undefined ? null : normalize(item, `${path}[${i}]`, seen));
    const record = value as Record<string, unknown>;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
      if (record[key] === undefined) continue;
      out[key] = normalize(record[key], `${path}.${key}`, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestCanonical(value: unknown, previousDigest: string | null = null): string {
  const envelope = { version: CANONICAL_DIGEST_V1, algorithm: DIGEST_ALGORITHM, previousDigest, payload: normalize(value) };
  return sha256Hex(canonicalJson(envelope));
}

export function equalDigest(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
