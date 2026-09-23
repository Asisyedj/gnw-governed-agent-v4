import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyExecutorToken(token: string, shared: string): boolean {
  if (!token || !shared) return false;
  try {
    const expected = createHmac("sha256", shared).update("gnw-executor-v1").digest("hex");
    const a = Buffer.from(token.trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
