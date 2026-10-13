/**
 * AWS Secrets Manager Provider — unit tests.
 *
 * These tests use mocked AWS SDK clients. No real AWS credentials or
 * network calls are involved. Secret values in test fixtures are synthetic
 * and disposable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SecretProvider } from "../../server/lib/secret-provider.js";

// ---------------------------------------------------------------------------
// Mock the AWS SDK client before importing the provider
// ---------------------------------------------------------------------------

const mockSend = vi.fn();
const mockDestroy = vi.fn();

vi.mock("@aws-sdk/client-secrets-manager", () => {
  class MockSecretsManagerClient {
    constructor(public config: Record<string, unknown>) {}
    send = mockSend;
    destroy = mockDestroy;
  }
  class GetSecretValueCommand {
    constructor(public input: { SecretId: string }) {}
  }
  class DescribeSecretCommand {
    constructor(public input: { SecretId: string }) {}
  }
  return {
    SecretsManagerClient: MockSecretsManagerClient,
    GetSecretValueCommand,
    DescribeSecretCommand,
  };
});

// Import AFTER mocks are registered
import {
  AwsSecretsManagerProvider,
  validateSecretArn,
  safeLabel,
  type AwsSecretsManagerConfig,
} from "../../server/lib/aws-secrets-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(
  overrides: Partial<AwsSecretsManagerConfig> = {},
): AwsSecretsManagerProvider {
  return new AwsSecretsManagerProvider({
    region: "us-east-1",
    ...overrides,
  });
}

function awsError(name: string, httpStatusCode: number): Error {
  const err = new Error(name) as Error & {
    name: string;
    $metadata: { httpStatusCode: number };
  };
  err.name = name;
  err.$metadata = { httpStatusCode };
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AwsSecretsManagerProvider", () => {
  let provider: AwsSecretsManagerProvider;

  beforeEach(() => {
    mockSend.mockReset();
    mockDestroy.mockReset();
    provider = makeProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  // =========================================================================
  // Constructor validation
  // =========================================================================

  describe("constructor", () => {
    it("requires a region", () => {
      expect(
        () => new AwsSecretsManagerProvider({ region: "" }),
      ).toThrow("region is required");
    });

    it("accepts a valid region", () => {
      const p = new AwsSecretsManagerProvider({ region: "eu-west-1" });
      expect(p.name).toBe("aws-secrets-manager");
      p.close();
    });

    it("accepts custom endpoint for LocalStack", () => {
      const p = new AwsSecretsManagerProvider({
        region: "us-east-1",
        endpoint: "http://localhost:4566",
      });
      expect(p.name).toBe("aws-secrets-manager");
      p.close();
    });
  });

  // =========================================================================
  // fetchSecret — success path
  // =========================================================================

  describe("fetchSecret — success", () => {
    it("retrieves a string secret value", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "test-db-url" });
      const value = await provider.fetchSecret("DATABASE_URL");
      expect(value).toBe("test-db-url");
    });

    it("caches on second call without hitting SDK again", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "cached-value" });
      await provider.fetchSecret("COOKIE_SECRET");
      const again = await provider.fetchSecret("COOKIE_SECRET");
      expect(again).toBe("cached-value");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("works with full ARN secret identifiers", async () => {
      const arn =
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:gnw/staging/db-AbCdEf";
      mockSend.mockResolvedValueOnce({ SecretString: "arn-value" });
      const value = await provider.fetchSecret(arn);
      expect(value).toBe("arn-value");
    });
  });

  // =========================================================================
  // fetchSecret — AccessDenied
  // =========================================================================

  describe("fetchSecret — AccessDenied", () => {
    it("throws a clear error on AccessDeniedException", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("AccessDeniedException", 403),
      );
      await expect(provider.fetchSecret("SECRET_KEY")).rejects.toThrow(
        "AccessDenied",
      );
    });

    it("error message mentions IAM permissions without leaking value", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("AccessDeniedException", 403),
      );
      await expect(provider.fetchSecret("SECRET_KEY")).rejects.toThrow(
        "secretsmanager:GetSecretValue",
      );
    });

    it("handles HTTP 403 without named exception", async () => {
      mockSend.mockRejectedValueOnce(awsError("UnknownError", 403));
      await expect(provider.fetchSecret("DENIED")).rejects.toThrow(
        "AccessDenied",
      );
    });
  });

  // =========================================================================
  // fetchSecret — ResourceNotFound
  // =========================================================================

  describe("fetchSecret — ResourceNotFound", () => {
    it("throws on ResourceNotFoundException", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("ResourceNotFoundException", 404),
      );
      await expect(provider.fetchSecret("MISSING")).rejects.toThrow(
        "secret not found",
      );
    });

    it("includes region in error for debugging", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("ResourceNotFoundException", 404),
      );
      await expect(provider.fetchSecret("MISSING")).rejects.toThrow(
        "us-east-1",
      );
    });
  });

  // =========================================================================
  // fetchSecret — DecryptionFailure
  // =========================================================================

  describe("fetchSecret — DecryptionFailure (CMK)", () => {
    it("throws on DecryptionFailureException with KMS guidance", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("DecryptionFailureException", 400),
      );
      await expect(provider.fetchSecret("ENCRYPTED")).rejects.toThrow(
        "kms:Decrypt",
      );
    });
  });

  // =========================================================================
  // fetchSecret — Timeout
  // =========================================================================

  describe("fetchSecret — Timeout", () => {
    it("throws on TimeoutError", async () => {
      mockSend.mockRejectedValueOnce(awsError("TimeoutError", 0));
      await expect(provider.fetchSecret("SLOW")).rejects.toThrow("timeout");
    });

    it("throws on ConnectTimeoutError", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("ConnectTimeoutError", 0),
      );
      await expect(provider.fetchSecret("SLOW")).rejects.toThrow("timeout");
    });

    it("includes configured timeout in error message", async () => {
      mockSend.mockRejectedValueOnce(awsError("TimeoutError", 0));
      await expect(provider.fetchSecret("SLOW")).rejects.toThrow("5000ms");
    });
  });

  // =========================================================================
  // fetchSecret — invalid payload
  // =========================================================================

  describe("fetchSecret — invalid payload", () => {
    it("throws on empty SecretString", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "" });
      await expect(provider.fetchSecret("EMPTY")).rejects.toThrow(
        "empty or binary-only",
      );
    });

    it("throws on undefined SecretString (binary-only)", async () => {
      mockSend.mockResolvedValueOnce({
        SecretBinary: new Uint8Array([1, 2, 3]),
      });
      await expect(provider.fetchSecret("BINARY")).rejects.toThrow(
        "empty or binary-only",
      );
    });

    it("throws on null SecretString", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: null });
      await expect(provider.fetchSecret("NULL")).rejects.toThrow(
        "empty or binary-only",
      );
    });
  });

  // =========================================================================
  // fetchSecret — generic SDK error
  // =========================================================================

  describe("fetchSecret — generic error", () => {
    it("wraps unknown SDK errors without leaking message", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("InternalServiceError", 500),
      );
      await expect(provider.fetchSecret("BROKEN")).rejects.toThrow(
        "InternalServiceError",
      );
      await expect(
        provider.fetchSecret("BROKEN"),
      ).rejects.not.toThrow("secret value");
    });
  });

  // =========================================================================
  // Secret redaction — safeLabel
  // =========================================================================

  describe("safeLabel — redaction", () => {
    it("returns plain name unchanged", () => {
      expect(safeLabel("DATABASE_URL")).toBe("DATABASE_URL");
    });

    it("redacts ARN middle parts", () => {
      const label = safeLabel(
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:gnw/db-AbCdEf",
      );
      expect(label).toBe("arn:***:secret:gnw/db-AbCdEf");
      expect(label).not.toContain("123456789012");
    });
  });

  // =========================================================================
  // ARN validation
  // =========================================================================

  describe("validateSecretArn", () => {
    it("allows plain secret names", () => {
      expect(() => validateSecretArn("DATABASE_URL", undefined)).not.toThrow();
    });

    it("allows valid ARNs", () => {
      expect(() =>
        validateSecretArn(
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:gnw/db-AbCdEf",
          undefined,
        ),
      ).not.toThrow();
    });

    it("rejects malformed ARNs", () => {
      expect(() =>
        validateSecretArn("arn:aws:s3:::my-bucket/key", undefined),
      ).toThrow("invalid ARN format");
    });

    it("rejects cross-account ARNs when allowedAccountId is set", () => {
      expect(() =>
        validateSecretArn(
          "arn:aws:secretsmanager:us-east-1:999999999999:secret:gnw/key-XyZ123",
          "123456789012",
        ),
      ).toThrow("Cross-account access denied");
    });

    it("allows same-account ARNs", () => {
      expect(() =>
        validateSecretArn(
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:gnw/key-XyZ123",
          "123456789012",
        ),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // healthCheck
  // =========================================================================

  describe("healthCheck", () => {
    it("returns true when DescribeSecret succeeds", async () => {
      mockSend.mockResolvedValueOnce({ Name: "gnw-health-check-probe" });
      expect(await provider.healthCheck()).toBe(true);
    });

    it("returns true on ResourceNotFoundException (API is reachable)", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("ResourceNotFoundException", 404),
      );
      expect(await provider.healthCheck()).toBe(true);
    });

    it("returns true on AccessDeniedException (credentials work)", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("AccessDeniedException", 403),
      );
      expect(await provider.healthCheck()).toBe(true);
    });

    it("returns false on network/connectivity errors", async () => {
      mockSend.mockRejectedValueOnce(
        awsError("NetworkingError", 0),
      );
      expect(await provider.healthCheck()).toBe(false);
    });
  });

  // =========================================================================
  // close()
  // =========================================================================

  describe("close", () => {
    it("rejects fetchSecret after close", async () => {
      await provider.close();
      await expect(provider.fetchSecret("X")).rejects.toThrow(
        "provider is closed",
      );
    });

    it("rejects healthCheck after close", async () => {
      await provider.close();
      await expect(provider.healthCheck()).rejects.toThrow(
        "provider is closed",
      );
    });

    it("calls client.destroy()", async () => {
      await provider.close();
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // SecretProvider interface conformance
  // =========================================================================

  describe("SecretProvider interface", () => {
    it("implements the SecretProvider interface", () => {
      // TypeScript compile-time check; this assignment must succeed
      const sp: SecretProvider = provider;
      expect(sp.name).toBe("aws-secrets-manager");
      expect(typeof sp.fetchSecret).toBe("function");
      expect(typeof sp.healthCheck).toBe("function");
      expect(typeof sp.close).toBe("function");
    });
  });

  // =========================================================================
  // createSecretProvider factory integration
  // =========================================================================

  describe("createSecretProvider factory", () => {
    it("creates AwsSecretsManagerProvider via 'aws' provider name", async () => {
      // Dynamic import to test factory wiring
      const { createSecretProvider } = await import(
        "../../server/lib/secret-provider.js"
      );
      const p = createSecretProvider("aws", {
        region: "us-west-2",
      });
      expect(p.name).toBe("aws-secrets-manager");
      await p.close();
    });
  });
});
