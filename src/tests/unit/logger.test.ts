import { describe, it, expect } from "vitest";
import { sanitize } from "../../server/lib/logger.js";

describe("sanitize", () => {
  it("redacts password fields", () => {
    const result = sanitize({ email: "a@b.com", password: "secret123" }) as Record<string, unknown>;
    expect(result.password).toBe("[REDACTED]");
    expect(result.email).toBe("a@b.com");
  });

  it("redacts nested secrets", () => {
    const result = sanitize({ user: { passwordHash: "hash", name: "Alice" } }) as Record<string, unknown>;
    const user = result.user as Record<string, unknown>;
    expect(user.passwordHash).toBe("[REDACTED]");
    expect(user.name).toBe("Alice");
  });

  it("passes through primitives", () => {
    expect(sanitize("hello")).toBe("hello");
    expect(sanitize(42)).toBe(42);
    expect(sanitize(null)).toBeNull();
  });
});
