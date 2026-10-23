/**
 * Production PostgreSQL must use exactly one sslmode=verify-full query parameter.
 * The flag is an explicit policy assertion, not a TLS disable switch.
 */
export function productionPostgresTlsErrors(
  databaseUrl: string,
  requiredFlag: string | undefined,
): string[] {
  const errors: string[] = [];
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return ["DATABASE_URL must be a valid PostgreSQL URL in production"];
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    errors.push("DATABASE_URL must use the PostgreSQL protocol in production");
  }
  if (!parsed.hostname || parsed.pathname.length < 2) {
    errors.push("DATABASE_URL must include a database host and name in production");
  }

  const sslModes = parsed.searchParams.getAll("sslmode");
  if (sslModes.length !== 1 || sslModes[0] !== "verify-full") {
    errors.push("DATABASE_URL must contain exactly one sslmode=verify-full parameter in production");
  }
  if (requiredFlag !== "true") {
    errors.push("GNW_POSTGRES_SSL_REQUIRED must be true in production");
  }

  return errors;
}

export function assertProductionPostgresTls(
  databaseUrl: string,
  requiredFlag: string | undefined,
): void {
  const errors = productionPostgresTlsErrors(databaseUrl, requiredFlag);
  if (errors.length > 0) {
    throw new Error("[GNW] Production PostgreSQL TLS policy failed:\n" + errors.map(x => "  - " + x).join("\n"));
  }
}
