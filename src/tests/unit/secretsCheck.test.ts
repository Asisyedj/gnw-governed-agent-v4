import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateSecrets } from "../../server/lib/secretsCheck.js";

const save = () => ({ ...process.env });

describe("validateSecrets", () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => { original = save(); });
  afterEach(() => { Object.assign(process.env, original); });

  it("passes with valid env", () => {
    process.env.DATABASE_URL  = "postgresql://u:p@localhost/db";
    process.env.COOKIE_SECRET = "a".repeat(32);
    process.env.NODE_ENV      = "development";
    expect(() => validateSecrets()).not.toThrow();
  });

  it("throws when DATABASE_URL missing", () => {
    delete process.env.DATABASE_URL;
    process.env.COOKIE_SECRET = "a".repeat(32);
    expect(() => validateSecrets()).toThrow("DATABASE_URL");
  });

  it("throws when COOKIE_SECRET missing", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    delete process.env.COOKIE_SECRET;
    expect(() => validateSecrets()).toThrow("COOKIE_SECRET");
  });

  it("throws when COOKIE_SECRET too short", () => {
    process.env.DATABASE_URL  = "postgresql://u:p@localhost/db";
    process.env.COOKIE_SECRET = "short";
    expect(() => validateSecrets()).toThrow("32 characters");
  });

  it("throws when COOKIE_SECRET is the placeholder", () => {
    process.env.DATABASE_URL  = "postgresql://u:p@localhost/db";
    process.env.COOKIE_SECRET = "REPLACE_WITH_OPENSSL_RAND_HEX_32";
    expect(() => validateSecrets()).toThrow("placeholder");
  });
});
