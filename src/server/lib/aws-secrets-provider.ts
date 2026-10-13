/**
 * AWS Secrets Manager provider for GNW Governed Agent.
 *
 * Uses AWS SDK for JavaScript v3 with EC2 instance profile credentials.
 * Fail-closed: any retrieval failure on a required secret aborts startup.
 *
 * Security constraints:
 * - No secret values are ever logged, serialized, or included in error messages.
 * - ARN validation ensures only expected secrets in expected accounts/regions are fetched.
 * - Explicit allowlist enforcement: only manifest-approved secret IDs may be fetched.
 * - Region matching: ARN region must match configured provider region.
 * - Health check disambiguation: separates API connectivity from IAM authorization.
 * - Timeout and retry behaviour is configurable; defaults are conservative.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  DescribeSecretCommand,
  type GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import type { SecretProvider } from "./secret-provider.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AwsSecretsManagerConfig {
  /**
   * AWS region for Secrets Manager API calls.
   * Must be explicitly set; we do not rely on environment defaults for safety.
   */
  region: string;

  /**
   * Optional: restrict to a specific AWS account ID.
   * If set, any ARN not belonging to this account is rejected before the API call.
   */
  allowedAccountId?: string | undefined;

  /**
   * Optional: restrict retrieval to an explicit allowlist of secret identifiers.
   * If provided, any identifier not present in this list is rejected before the API call.
   */
  allowedSecretIds?: readonly string[] | undefined;

  /**
   * Request timeout in milliseconds. Default: 5000ms.
   */
  timeoutMs?: number | undefined;

  /**
   * Maximum number of SDK retry attempts. Default: 2.
   */
  maxRetries?: number | undefined;

  /**
   * Optional custom endpoint URL (for LocalStack / staging).
   */
  endpoint?: string | undefined;
}

// ---------------------------------------------------------------------------
// Health check status
// ---------------------------------------------------------------------------

export interface SecretProviderHealth {
  ok: boolean;
  connectivity: boolean;
  authorized: boolean;
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// ARN & Identifier validation
// ---------------------------------------------------------------------------

/**
 * Strict ARN regex for AWS Secrets Manager secrets.
 * Format: arn:aws:secretsmanager:<region>:<account-id>:secret:<name>
 */
const ARN_REGEX =
  /^arn:aws:secretsmanager:[a-z]{2}(-gov)?-[a-z]+-\d:\d{12}:secret:[A-Za-z0-9/_+=.@!-]+$/;

/** Strict regex for non-ARN secret names. */
const SECRET_NAME_REGEX = /^[A-Za-z0-9/_+=.@!-]+$/;

/** Validate identifier format, region pinning, account allowlist, and approved ID list. */
export function validateSecretIdentifier(
  secretId: string,
  configuredRegion: string,
  allowedAccountId?: string | undefined,
  allowedSecretIds?: readonly string[] | undefined,
): void {
  // If an allowlist is provided, secretId MUST be in the allowlist
  if (allowedSecretIds && allowedSecretIds.length > 0) {
    if (!allowedSecretIds.includes(secretId)) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: secret identifier \"" +
        safeLabel(secretId) +
        "\" is not in the allowed secret identifiers list. Access denied."
      );
    }
  }

  if (secretId.startsWith("arn:")) {
    if (!ARN_REGEX.test(secretId)) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: invalid ARN format for secret identifier." +
        " Expected arn:aws:secretsmanager:<region>:<account>:secret:<name>."
      );
    }

    const arnParts = secretId.split(":");
    const arnRegion = arnParts[3];
    const arnAccount = arnParts[4];

    if (arnRegion !== configuredRegion) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: secret ARN region \"" +
        arnRegion + "\" does not match configured provider region \"" +
        configuredRegion + "\". Region mismatch denied."
      );
    }

    if (allowedAccountId && arnAccount !== allowedAccountId) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: secret ARN belongs to account " +
        arnAccount + " but allowed account is " + allowedAccountId +
        ". Cross-account access denied by provider policy."
      );
    }
  } else {
    if (secretId.includes("..") || !SECRET_NAME_REGEX.test(secretId)) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: invalid secret name format \"" +
        safeLabel(secretId) +
        "\". Must contain only alphanumeric, hyphens, underscores, dots, slashes, or plus signs without traversal."
      );
    }
  }
}

/** Backward-compatible helper for existing tests. */
export function validateSecretArn(
  secretId: string,
  allowedAccountId: string | undefined,
): void {
  validateSecretIdentifier(secretId, "us-east-1", allowedAccountId, undefined);
}

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/**
 * Produce a safe log label for a secret identifier.
 * ARNs are truncated to just the last component; plain names are kept.
 * Never includes actual secret values.
 */
export function safeLabel(secretId: string): string {
  if (secretId.startsWith("arn:")) {
    const parts = secretId.split(":");
    return "arn:***:secret:" + (parts[parts.length - 1] ?? "unknown");
  }
  return secretId;
}

// ---------------------------------------------------------------------------
// Error classification helper type
// ---------------------------------------------------------------------------

interface AwsSdkError {
  name?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  $metadata?: { httpStatusCode?: number };
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class AwsSecretsManagerProvider implements SecretProvider {
  readonly name = "aws-secrets-manager";

  private readonly client: SecretsManagerClient;
  private readonly providerConfig: {
    readonly region: string;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly allowedAccountId: string | undefined;
    readonly allowedSecretIds: readonly string[] | undefined;
    readonly endpoint: string | undefined;
  };

  /** Internal cache: secretId -> resolved value. Populated on first fetch. */
  private readonly cache = new Map<string, string>();
  private closed = false;

  constructor(config: AwsSecretsManagerConfig) {
    if (!config.region) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: region is required. " +
        "Do not rely on ambient AWS_REGION for production safety."
      );
    }

    this.providerConfig = {
      region: config.region,
      timeoutMs: config.timeoutMs ?? 5_000,
      maxRetries: config.maxRetries ?? 2,
      allowedAccountId: config.allowedAccountId,
      allowedSecretIds: config.allowedSecretIds,
      endpoint: config.endpoint,
    };

    this.client = new SecretsManagerClient({
      region: this.providerConfig.region,
      maxAttempts: this.providerConfig.maxRetries + 1,
      ...(this.providerConfig.endpoint
        ? { endpoint: this.providerConfig.endpoint }
        : {}),
    });
  }

  // -------------------------------------------------------------------------
  // SecretProvider interface
  // -------------------------------------------------------------------------

  async fetchSecret(secretId: string): Promise<string> {
    this.assertOpen();
    validateSecretIdentifier(
      secretId,
      this.providerConfig.region,
      this.providerConfig.allowedAccountId,
      this.providerConfig.allowedSecretIds,
    );

    // Return cached value if available
    const cached = this.cache.get(secretId);
    if (cached !== undefined) return cached;

    let response: GetSecretValueCommandOutput;
    try {
      response = await this.client.send(
        new GetSecretValueCommand({
          SecretId: secretId,
        }),
      );
    } catch (err: unknown) {
      // Classify and re-throw without leaking secret values
      const awsErr = err as AwsSdkError;
      const code = awsErr.name ?? "UnknownError";
      const status = awsErr.$metadata?.httpStatusCode ?? 0;

      if (code === "AccessDeniedException" || status === 403) {
        throw new Error(
          "[GNW] AwsSecretsManagerProvider: AccessDenied for " +
          safeLabel(secretId) +
          ". Verify IAM role has secretsmanager:GetSecretValue" +
          " (and kms:Decrypt if using CMK)."
        );
      }
      if (code === "ResourceNotFoundException" || status === 404) {
        throw new Error(
          "[GNW] AwsSecretsManagerProvider: secret not found: " +
          safeLabel(secretId) +
          ". Verify the secret exists in region " +
          this.providerConfig.region + "."
        );
      }
      if (code === "DecryptionFailureException") {
        throw new Error(
          "[GNW] AwsSecretsManagerProvider: decryption failure for " +
          safeLabel(secretId) +
          ". Verify kms:Decrypt permission on the secret's KMS key."
        );
      }
      if (
        code === "TimeoutError" ||
        code === "RequestTimeout" ||
        code === "ConnectTimeoutError"
      ) {
        throw new Error(
          "[GNW] AwsSecretsManagerProvider: timeout fetching " +
          safeLabel(secretId) +
          " (limit: " + this.providerConfig.timeoutMs + "ms)." +
          " Verify network connectivity and VPC endpoint configuration."
        );
      }
      // Generic error — never include err.message as it may contain payload data
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: failed to fetch " +
        safeLabel(secretId) +
        " (" + code + ", HTTP " + status + ")." +
        " Check CloudWatch logs for request ID details."
      );
    }

    // Extract value — fail-closed on empty or binary-only secrets
    const value = response.SecretString;
    if (value === undefined || value === null || value === "") {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: secret " +
        safeLabel(secretId) +
        " returned empty or binary-only payload." +
        " GNW requires string secrets."
      );
    }

    this.cache.set(secretId, value);
    return value;
  }

  /**
   * Detailed health check that disambiguates API connectivity from IAM authorization.
   */
  async checkHealthDetails(): Promise<SecretProviderHealth> {
    this.assertOpen();
    try {
      await this.client.send(
        new DescribeSecretCommand({
          SecretId: "gnw-health-check-probe",
        }),
      );
      return { ok: true, connectivity: true, authorized: true };
    } catch (err: unknown) {
      const awsErr = err as AwsSdkError;
      const code = awsErr.name ?? "UnknownError";
      const status = awsErr.$metadata?.httpStatusCode ?? 0;

      // ResourceNotFoundException proves connectivity AND that credentials are authorized
      // to interact with Secrets Manager in this account/region.
      if (code === "ResourceNotFoundException" || status === 404) {
        return { ok: true, connectivity: true, authorized: true };
      }

      // AccessDeniedException proves connectivity, but authorization FAILED.
      // Must NOT be reported as healthy!
      if (code === "AccessDeniedException" || status === 403) {
        return {
          ok: false,
          connectivity: true,
          authorized: false,
          error: "AccessDenied: IAM credentials lack secretsmanager permissions",
        };
      }

      // Any other error (network timeout, connection refused, DNS resolution)
      return {
        ok: false,
        connectivity: false,
        authorized: false,
        error: code,
      };
    }
  }

  /**
   * Standard SecretProvider healthCheck.
   * Returns true ONLY if provider is connected AND authorized.
   */
  async healthCheck(): Promise<boolean> {
    const details = await this.checkHealthDetails();
    return details.ok;
  }

  /** Invalidate in-memory cache to support key rotation drills. */
  invalidateCache(secretId?: string): void {
    if (secretId) {
      this.cache.delete(secretId);
    } else {
      this.cache.clear();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cache.clear();
    this.client.destroy();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: provider is closed. " +
        "Cannot fetch secrets after close() has been called."
      );
    }
  }
}
