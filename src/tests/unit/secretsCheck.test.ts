import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateSecrets } from "../../server/lib/secretsCheck.js";

const save = () => ({ ...process.env });

describe("validateSecrets", () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => { original = save(); });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it("passes with valid development env", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.COOKIE_SECRET = "a".repeat(32);
    process.env.NODE_ENV = "development";
    expect(() => validateSecrets()).not.toThrow();
  });

  it("throws when DATABASE_URL missing", () => {
    delete process.env.DATABASE_URL;
    process.env.COOKIE_SECRET = "a".repeat(32);
    process.env.NODE_ENV = "development";
    expect(() => validateSecrets()).toThrow("DATABASE_URL");
  });

  it("throws when COOKIE_SECRET missing", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    delete process.env.COOKIE_SECRET;
    process.env.NODE_ENV = "development";
    expect(() => validateSecrets()).toThrow("COOKIE_SECRET");
  });

  it("throws when COOKIE_SECRET too short", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.COOKIE_SECRET = "short";
    process.env.NODE_ENV = "development";
    expect(() => validateSecrets()).toThrow("32 characters");
  });

  it("throws when COOKIE_SECRET is the placeholder", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.COOKIE_SECRET = "REPLACE_WITH_OPENSSL_RAND_HEX_32";
    process.env.NODE_ENV = "development";
    expect(() => validateSecrets()).toThrow("placeholder");
  });

  it("rejects incomplete production security configuration", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://u:p@db.internal/gnw";
    process.env.COOKIE_SECRET = "a".repeat(32);
    expect(() => validateSecrets()).toThrow("SESSION_SECRET");
    expect(() => validateSecrets()).toThrow("EXECUTOR_SECRET");
    expect(() => validateSecrets()).toThrow("GNW_REQUIRE_SIGNED_GRANTS");
  });

  it("accepts a complete production security configuration", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://u:p@db.internal/gnw?sslmode=verify-full";
    process.env.COOKIE_SECRET = "a".repeat(32);
    process.env.SESSION_SECRET = "b".repeat(32);
    process.env.EXECUTOR_URL = "https://executor.internal.example";
    process.env.EXECUTOR_SECRET = "c".repeat(32);
    process.env.GNW_REQUIRE_SIGNED_GRANTS = "true";
    process.env.GNW_GRANT_ISSUER = "gnw-production";
    process.env.GNW_GRANT_PRIVATE_KEY_PEM = "private";
    process.env.GNW_GRANT_PUBLIC_KEY_PEM = "public";
    process.env.GNW_LEASE_PRIVATE_KEY_PEM = "private";
    process.env.GNW_EGRESS_ALLOW_LIST = "api.openai.com";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_API_KEY = "test-key";
    process.env.STORAGE_DRIVER = "local";
    process.env.GNW_SHARED_STORAGE_CONFIRMED = "true";

    expect(() => validateSecrets()).not.toThrow();
  });
});
