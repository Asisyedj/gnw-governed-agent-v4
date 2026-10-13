/**
 * Secret Manager provider abstraction for GNW Governed Agent.
 *
 * Supports pluggable secret backends: env-file (staging/dev), or cloud
 * providers (GCP, AWS, Azure, Vault) via implementations.
 *
 * Design: fail-closed — if any required secret cannot be fetched, startup
 * must abort. No fallback to empty strings for production secrets.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AwsSecretsManagerProvider } from "./aws-secrets-provider.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SecretProvider {
  /** Human-readable provider name for diagnostics. */
  readonly name: string;

  /** Fetch a single secret value by its provider-specific ID. */
  fetchSecret(secretId: string): Promise<string>;

  /** Verify connectivity and authorization to the secret backend. */
  healthCheck(): Promise<boolean>;

  /** Release provider resources. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Manifest schema
// ---------------------------------------------------------------------------

export interface SecretManifestEntry {
  /** Provider-specific secret identifier (env var name for env-file). */
  secretId: string;
  /** Optional version/label (e.g. "latest", "3"). */
  version?: string;
  /** Whether startup must abort if this secret cannot be fetched. */
  required: boolean;
  /** Human-readable category for reporting. */
  category?: string;
}

export interface SecretManifest {
  schema: "GNW.SecretManifest.v1";
  provider: "env-file" | "gcp" | "aws" | "azure" | "vault";
  secrets: Record<string, SecretManifestEntry>;
}

// ---------------------------------------------------------------------------
// EnvFileProvider — staging / development only
// ---------------------------------------------------------------------------

export class EnvFileProvider implements SecretProvider {
  readonly name = "env-file";
  private env: Record<string, string> = {};
  private loaded = false;

  constructor(private readonly envPath: string) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[GNW] EnvFileProvider MUST NOT be used in production. " +
        "Configure GNW_SECRET_PROVIDER to a cloud provider."
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    await this.ensureLoaded();
    return Object.keys(this.env).length > 0;
  }

  async fetchSecret(secretId: string): Promise<string> {
    await this.ensureLoaded();
    const value = this.env[secretId];
    if (value === undefined) {
      throw new Error(
        `[GNW] EnvFileProvider: secret "${secretId}" not found in ${this.envPath}`
      );
    }
    return value;
  }

  async close(): Promise<void> {
    this.env = {};
    this.loaded = false;
  }

  // -- internal --

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const abs = resolve(this.envPath);
    const raw = await readFile(abs, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      this.env[key] = val;
    }
    this.loaded = true;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SecretProviderFactoryConfig {
  region?: string | undefined;
  AWS_REGION?: string | undefined;
  allowedAccountId?: string | undefined;
  allowedSecretIds?: readonly string[] | undefined;
  endpoint?: string | undefined;
  timeoutMs?: string | number | undefined;
  maxRetries?: string | number | undefined;
  envPath?: string | undefined;
  [key: string]: unknown;
}

export function createSecretProvider(
  providerName: string,
  config: SecretProviderFactoryConfig = {}
): SecretProvider {
  switch (providerName) {
    case "env-file":
      return new EnvFileProvider(
        typeof config.envPath === "string" ? config.envPath : ".env.staging"
      );
    case "aws":
      return new AwsSecretsManagerProvider({
        region:
          (typeof config.region === "string" ? config.region : undefined) ??
          (typeof config.AWS_REGION === "string" ? config.AWS_REGION : undefined) ??
          "",
        allowedAccountId:
          typeof config.allowedAccountId === "string"
            ? config.allowedAccountId
            : undefined,
        allowedSecretIds: Array.isArray(config.allowedSecretIds)
          ? (config.allowedSecretIds as string[])
          : undefined,
        endpoint:
          typeof config.endpoint === "string" ? config.endpoint : undefined,
        timeoutMs: config.timeoutMs !== undefined ? Number(config.timeoutMs) : undefined,
        maxRetries: config.maxRetries !== undefined ? Number(config.maxRetries) : undefined,
      });
    // Future: case "gcp": return new GcpSecretManager(config);
    // Future: case "azure": return new AzureKeyVault(config);
    // Future: case "vault": return new VaultProvider(config);
    default:
      throw new Error(
        "[GNW] Unknown secret provider: " + providerName +
        ". Supported: env-file, gcp, aws, azure, vault"
      );
  }
}

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------

export async function loadManifest(manifestPath: string): Promise<SecretManifest> {
  const raw = await readFile(resolve(manifestPath), "utf-8");
  const parsed = JSON.parse(raw) as SecretManifest;
  if (parsed.schema !== "GNW.SecretManifest.v1") {
    throw new Error(
      "[GNW] Invalid secret manifest schema: " + (parsed.schema ?? "missing")
    );
  }
  if (!parsed.provider || !parsed.secrets) {
    throw new Error("[GNW] Secret manifest missing provider or secrets");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Preflight runner
// ---------------------------------------------------------------------------

export interface PreflightResult {
  schema: "GNW.PreflightSecrets.v1";
  provider: string;
  timestamp: string;
  secretCount: number;
  fetchedCount: number;
  failedSecrets: string[];
  status: "PASS" | "FAIL";
}

export async function runPreflight(
  manifest: SecretManifest,
  provider: SecretProvider
): Promise<PreflightResult> {
  const entries = Object.entries(manifest.secrets);
  const failed: string[] = [];
  let fetched = 0;

  for (const [envVar, entry] of entries) {
    try {
      const value = await provider.fetchSecret(entry.secretId);
      if (!value && entry.required) {
        failed.push(envVar);
      } else {
        fetched++;
      }
    } catch {
      if (entry.required) {
        failed.push(envVar);
      }
    }
  }

  return {
    schema: "GNW.PreflightSecrets.v1",
    provider: provider.name,
    timestamp: new Date().toISOString(),
    secretCount: entries.length,
    fetchedCount: fetched,
    failedSecrets: failed,
    status: failed.length === 0 ? "PASS" : "FAIL",
  };
}

// ---------------------------------------------------------------------------
// Runtime Startup Bootstrap
// ---------------------------------------------------------------------------

export interface BootstrapSecretsOptions {
  manifestPath?: string | undefined;
  providerName?: string | undefined;
  config?: SecretProviderFactoryConfig | undefined;
  overrideExistingEnv?: boolean | undefined;
}

export interface BootstrapSecretsResult {
  provider: string;
  loadedCount: number;
  requiredCount: number;
  keys: string[];
}

/**
 * Bootstrap runtime secrets from configured SecretProvider before application startup.
 * Fail-closed: any failure fetching a required secret throws an error and aborts startup.
 */
export async function bootstrapRuntimeSecrets(
  options: BootstrapSecretsOptions = {}
): Promise<BootstrapSecretsResult> {
  const provider = options.providerName ?? process.env.GNW_SECRET_PROVIDER;
  if (!provider || provider === "none" || provider === "env") {
    return {
      provider: "none",
      loadedCount: 0,
      requiredCount: 0,
      keys: [],
    };
  }

  const manifestPath =
    options.manifestPath ??
    process.env.GNW_SECRET_MANIFEST ??
    (provider === "aws" ? "secret-manifest.staging-aws.json" : "secret-manifest.staging.json");

  const manifest = await loadManifest(manifestPath);

  // Extract strict allowlist of secret IDs declared in the manifest
  const allowedSecretIds = Object.values(manifest.secrets).map((s) => s.secretId);

  const providerInstance = createSecretProvider(manifest.provider, {
    ...options.config,
    region:
      options.config?.region ??
      (typeof process.env.AWS_REGION === "string" ? process.env.AWS_REGION : undefined) ??
      "us-east-1",
    allowedAccountId:
      options.config?.allowedAccountId ?? process.env.AWS_ALLOWED_ACCOUNT_ID,
    allowedSecretIds,
    endpoint:
      options.config?.endpoint ?? process.env.AWS_ENDPOINT_URL,
    envPath:
      options.config?.envPath ?? process.env.GNW_ENV_FILE ?? ".env.staging",
  });

  // Verify health before retrieval — fail closed if unauthorized or unreachable
  const isHealthy = await providerInstance.healthCheck();
  if (!isHealthy) {
    await providerInstance.close();
    throw new Error(
      `[GNW] Fatal startup error: secret provider "${manifest.provider}" failed health check. Verify credentials, IAM permissions, and connectivity.`
    );
  }

  const keys: string[] = [];
  const requiredCount = Object.values(manifest.secrets).filter((s) => s.required).length;

  try {
    for (const [envVar, entry] of Object.entries(manifest.secrets)) {
      try {
        const val = await providerInstance.fetchSecret(entry.secretId);
        if (!val && entry.required) {
          throw new Error(
            `[GNW] Fatal startup error: required secret "${envVar}" (${entry.secretId}) returned empty payload.`
          );
        }
        if (val) {
          if (options.overrideExistingEnv !== false || process.env[envVar] === undefined) {
            process.env[envVar] = val;
          }
          keys.push(envVar);
        }
      } catch (err: unknown) {
        if (entry.required) {
          throw new Error(
            `[GNW] Fatal startup error: required secret "${envVar}" (${entry.secretId}) failed to load: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
  } finally {
    await providerInstance.close();
  }

  return {
    provider: manifest.provider,
    loadedCount: keys.length,
    requiredCount,
    keys,
  };
}
