import { describe, expect, it } from "vitest";
import { digestEnvelope, validateEnvelope } from "../../server/action-envelope.js";

const base = {
  taskId: "1", tenantId: "1", actorId: "7", operation: "research",
  tool: "knowledge.search", parameters: { q: "safe" }, grantId: "grant-1",
  nonce: "nonce-1", issuedAt: Date.now(),
};

describe("ActionEnvelope", () => {
  it("binds the entire intended action into the digest", () => {
    const a = digestEnvelope(base);
    const b = digestEnvelope({ ...base, parameters: { q: "tampered" } });
    expect(a).not.toBe(b);
  });

  it("rejects malformed or expired envelopes", () => {
    expect(() => validateEnvelope(base)).not.toThrow();
    expect(() => validateEnvelope({ ...base, issuedAt: Date.now() - 300_001 })).toThrow();
  });

  it("enforces authorization context binding", () => {
    expect(() => validateEnvelope(base, Date.now(), 300_000, {
      taskId: 1, tenantId: 1, actorId: 7, grantId: "grant-1",
      nonce: "nonce-1", operation: "research", tool: "knowledge.search",
    })).not.toThrow();
    expect(() => validateEnvelope({ ...base, tool: "browser.fetch" }, Date.now(), 300_000, {
      taskId: 1, tenantId: 1, actorId: 7, grantId: "grant-1",
      nonce: "nonce-1", operation: "research", tool: "knowledge.search",
    })).toThrow();
  });
});