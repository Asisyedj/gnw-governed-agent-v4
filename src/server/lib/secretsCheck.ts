/**
 * Startup secrets validation — fail fast before serving any traffic.
 * Called once at boot; throws if any required secret is missing or insecure.
 */
export function validateSecrets(): void {
  const errors: string[] = [];

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) errors.push("DATABASE_URL is required");

  const cookieSecret = process.env.COOKIE_SECRET;
  if (!cookieSecret) errors.push("COOKIE_SECRET is required");
  else if (cookieSecret.length < 32) errors.push("COOKIE_SECRET must be at least 32 characters");
  else if (cookieSecret === "REPLACE_WITH_OPENSSL_RAND_HEX_32") errors.push("COOKIE_SECRET is still the placeholder value — generate a real secret");

  if (process.env.NODE_ENV === "production") {
    if (dbUrl && !dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))
      errors.push("DATABASE_URL must be a valid PostgreSQL connection string");
  }

  if (errors.length > 0) {
    throw new Error(`[GNW] Startup secrets validation failed:\n${errors.map(e => `  • ${e}`).join("\n")}`);
  }
}
