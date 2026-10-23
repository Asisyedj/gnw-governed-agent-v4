import { describe, expect, it } from "vitest";
import { productionPostgresTlsErrors } from "../../server/db/ssl-policy.js";

const validUrl = "postgresql://gnw_app:secret@db.internal:5432/gnw?sslmode=verify-full";

describe("production PostgreSQL TLS policy", () => {
  it("accepts a single verify-full mode with explicit enforcement", () => {
    expect(productionPostgresTlsErrors(validUrl, "true")).toEqual([]);
  });

  it.each([
    ["missing sslmode", "postgresql://u:p@db.internal:5432/gnw"],
    ["weaker sslmode", "postgresql://u:p@db.internal:5432/gnw?sslmode=require"],
    ["disabled SSL", "postgresql://u:p@db.internal:5432/gnw?sslmode=disable"],
    ["duplicate sslmode", "postgresql://u:p@db.internal:5432/gnw?sslmode=verify-full&sslmode=disable"],
    ["wrong protocol", "https://db.internal/gnw?sslmode=verify-full"],
    ["missing database", "postgresql://u:p@db.internal?sslmode=verify-full"],
  ])("rejects %s", (_label, url) => {
    expect(productionPostgresTlsErrors(url, "true").length).toBeGreaterThan(0);
  });

  it("rejects an unset or false GNW_POSTGRES_SSL_REQUIRED flag", () => {
    expect(productionPostgresTlsErrors(validUrl, undefined)).toContain(
      "GNW_POSTGRES_SSL_REQUIRED must be true in production",
    );
    expect(productionPostgresTlsErrors(validUrl, "false")).toContain(
      "GNW_POSTGRES_SSL_REQUIRED must be true in production",
    );
  });
});
