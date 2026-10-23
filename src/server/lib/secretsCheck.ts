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

    const storageDriver=(process.env.STORAGE_DRIVER ?? "").toLowerCase();
    if (!storageDriver) errors.push("STORAGE_DRIVER is required in production");
    if (storageDriver !== "local") errors.push("STORAGE_DRIVER must be local until the S3 storage driver is implemented");
    if (storageDriver === "local" && process.env.GNW_SHARED_STORAGE_CONFIRMED !== "true") {
      errors.push("GNW_SHARED_STORAGE_CONFIRMED must be true when local shared storage is used in production");
    }

    const mcpEnabled = process.env.GNW_MCP_ENABLED ?? "false";
    if (!["true", "false"].includes(mcpEnabled)) errors.push("GNW_MCP_ENABLED must be true or false");
    if (mcpEnabled === "true") {
      const base = process.env.GNW_MCP_PUBLIC_BASE_URL ?? "";
      const resource = process.env.GNW_MCP_RESOURCE_URL ?? "";
      if (!base || !resource) errors.push("GNW_MCP_PUBLIC_BASE_URL and GNW_MCP_RESOURCE_URL are required when GNW_MCP_ENABLED=true");
      try {
        const baseUrl = new URL(base);
        const resourceUrl = new URL(resource);
        if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || (baseUrl.pathname !== "/" && baseUrl.pathname !== "")) {
          errors.push("GNW_MCP_PUBLIC_BASE_URL must be an HTTPS origin without credentials, path, query or fragment");
        }
        if (resource !== baseUrl.origin + "/mcp" || resourceUrl.origin !== baseUrl.origin || resourceUrl.pathname !== "/mcp" || resourceUrl.search || resourceUrl.hash || resourceUrl.username || resourceUrl.password) {
          errors.push("GNW_MCP_RESOURCE_URL must exactly equal GNW_MCP_PUBLIC_BASE_URL origin plus /mcp");
        }
      } catch {
        errors.push("GNW MCP public base/resource URL configuration is invalid");
      }
    }
  }

  if (errors.length > 0) {
    throw new Error("[GNW] Startup security validation failed:\n" + errors.map(e => "  • " + e).join("\n"));
  }
}
