import { URL } from "node:url";

function minSecret(errors: string[], name: string, value: string | undefined, min = 32): void {
  if (!value) errors.push(name + " is required");
  else if (value.length < min) errors.push(name + " must be at least " + min + " characters");
}

function requiredHttps(errors: string[], name: string, value: string | undefined): void {
  if (!value) errors.push(name + " is required");
  else {
    try {
      if (new URL(value).protocol !== "https:") errors.push(name + " must use HTTPS in production");
    } catch {
      errors.push(name + " must be a valid URL");
    }
  }
}

/**
 * Startup secrets/config validation — fail fast before serving production traffic.
 * This validates presence and basic security properties only; secret values must
 * remain in the deployment secret manager, never in source control.
 */
export function validateSecrets(): void {
  const errors: string[] = [];

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) errors.push("DATABASE_URL is required");
  else if (process.env.NODE_ENV === "production" &&
    !dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    errors.push("DATABASE_URL must be a valid PostgreSQL connection string");
  }

  minSecret(errors,"COOKIE_SECRET",process.env.COOKIE_SECRET);
  if (process.env.COOKIE_SECRET === "REPLACE_WITH_OPENSSL_RAND_HEX_32") {
    errors.push("COOKIE_SECRET is still the placeholder value");
  }

  if (process.env.NODE_ENV === "production") {
    minSecret(errors,"SESSION_SECRET",process.env.SESSION_SECRET);

    const executorUrl = process.env.EXECUTOR_URL;
    requiredHttps(errors,"EXECUTOR_URL",executorUrl);
    minSecret(errors,"EXECUTOR_SECRET",process.env.EXECUTOR_SECRET);

    if (process.env.GNW_REQUIRE_SIGNED_GRANTS !== "true") {
      errors.push("GNW_REQUIRE_SIGNED_GRANTS must be true in production");
    }
    if (!process.env.GNW_GRANT_ISSUER) errors.push("GNW_GRANT_ISSUER is required");
    if (!process.env.GNW_GRANT_PRIVATE_KEY_PEM) errors.push("GNW_GRANT_PRIVATE_KEY_PEM is required");
    if (!process.env.GNW_GRANT_PUBLIC_KEY_PEM) errors.push("GNW_GRANT_PUBLIC_KEY_PEM is required");
    if (!process.env.GNW_LEASE_PRIVATE_KEY_PEM) errors.push("GNW_LEASE_PRIVATE_KEY_PEM is required");

    if (process.env.GNW_REQUIRE_TEE_ATTESTATION !== "true") {
      errors.push("GNW_REQUIRE_TEE_ATTESTATION must be true in production");
    }
    if (!process.env.GNW_TEE_ATTESTATION_ISSUER) errors.push("GNW_TEE_ATTESTATION_ISSUER is required");
    if (!process.env.GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM) errors.push("GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM is required");
    if (!/^[0-9a-f]{64}$/i.test(process.env.GNW_TEE_ATTESTATION_MEASUREMENT ?? "")) {
      errors.push("GNW_TEE_ATTESTATION_MEASUREMENT must be a 64-hex expected measurement");
    }

    const allowList=(process.env.GNW_EGRESS_ALLOW_LIST ?? "").split(",").map(x=>x.trim()).filter(Boolean);
    if (!allowList.length) errors.push("GNW_EGRESS_ALLOW_LIST must not be empty in production");

    const llmBase=process.env.LLM_BASE_URL;
    requiredHttps(errors,"LLM_BASE_URL",llmBase);
    if (!process.env.LLM_API_KEY) errors.push("LLM_API_KEY is required in production");

    const storageDriver=(process.env.STORAGE_DRIVER ?? "local").toLowerCase();
    if (storageDriver !== "local" && storageDriver !== "s3") errors.push("STORAGE_DRIVER must be local or s3");
    if (storageDriver === "local" && process.env.GNW_SHARED_STORAGE_CONFIRMED !== "true") {
      errors.push("GNW_SHARED_STORAGE_CONFIRMED must be true when local shared storage is used in production");
    }
  }

  if (errors.length > 0) {
    throw new Error("[GNW] Startup security validation failed:\n" + errors.map(e => "  • " + e).join("\n"));
  }
}
