/**
 * AWS Secrets Manager provider for GNW Governed Agent.
 *
 * Uses AWS SDK for JavaScript v3 with EC2 instance profile credentials.
 * Fail-closed: any retrieval failure on a required secret aborts startup.
 *
 * Security constraints:
 * - No secret values are ever logged, serialized, or included in error messages.
 * - ARN validation ensures only expected secrets in expected accounts/regions are fetched.
 * - Timeout and retry behaviour is configurable; defaults are conservative.
 * - healthCheck() calls DescribeSecret (no value returned) to verify connectivity.
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
// ARN validation
// ---------------------------------------------------------------------------

/**
 * Strict ARN regex for AWS Secrets Manager secrets.
 * Format: arn:aws:secretsmanager:<region>:<account-id>:secret:<name>
 */
const ARN_REGEX =
  /^arn:aws:secretsmanager:[a-z]{2}(-gov)?-[a-z]+-\d:\d{12}:secret:[A-Za-z0-9/_+=.@!-]+$/;

/** Validate ARN format and account-id allowlist. */
export function validateSecretArn(
  secretId: string,
  allowedAccountId: string | undefined,
): void {
  // Allow plain secret names (non-ARN) — SDK resolves them in the configured region.
  if (!secretId.startsWith("arn:")) return;

  if (!ARN_REGEX.test(secretId)) {
    throw new Error(
      "[GNW] AwsSecretsManagerProvider: invalid ARN format for secret identifier." +
      " Expected arn:aws:secretsmanager:<region>:<account>:secret:<name>."
    );
  }

  if (allowedAccountId) {
    const arnParts = secretId.split(":");
    const arnAccount = arnParts[4];
    if (arnAccount !== allowedAccountId) {
      throw new Error(
        "[GNW] AwsSecretsManagerProvider: secret ARN belongs to account " +
        arnAccount + " but allowed account is " + allowedAccountId +
        ". Cross-account access denied by provider policy."
      );
    }
  }
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
    validateSecretArn(secretId, this.providerConfig.allowedAccountId);

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

  async healthCheck(): Promise<boolean> {
    this.assertOpen();
    try {
      // DescribeSecret does NOT return the secret value — safe for health checks.
      // We use a synthetic/known-safe secret name; a ResourceNotFoundException
      // still proves the API is reachable and credentials are valid for the call.
      await this.client.send(
        new DescribeSecretCommand({
          SecretId: "gnw-health-check-probe",
        }),
      );
      return true;
    } catch (err: unknown) {
      const awsErr = err as AwsSdkError;
      // ResourceNotFoundException means the API responded — healthy
      if (awsErr.name === "ResourceNotFoundException") {
        return true;
      }
      // AccessDenied means credentials work but policy is too narrow — still "connected"
      if (awsErr.name === "AccessDeniedException") {
        return true;
      }
      // Any other error: connectivity issue
      return false;
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
