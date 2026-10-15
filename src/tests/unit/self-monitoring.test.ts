import { describe, expect, it } from "vitest";
import { evaluateSelfMonitoring, type SelfMonitoringCheck } from "../../server/self-monitoring.js";

const check = (overrides: Partial<SelfMonitoringCheck> = {}): SelfMonitoringCheck => ({
  id: "database.health",
  domain: "operational",
  status: "pass",
  severity: "low",
  summary: "Database health check passed",
  evidenceRef: "ci:run-123",
  ...overrides,
});

describe("governed self-monitoring evaluator", () => {
  it("passes when all checks pass and creates a deterministic evidence digest", () => {
    const checks = [check(), check({ id: "egress.allowlist", domain: "security" })];
    const first = evaluateSelfMonitoring(checks, 1_800_000_000_000);
    const second = evaluateSelfMonitoring(checks, 1_800_000_000_000);

    expect(first.decision).toBe("PASS");
    expect(first.findings).toHaveLength(0);
    expect(first.digest).toBe(second.digest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.findings)).toBe(true);
  });

  it("denies sensitive execution when a security boundary fails", () => {
    const report = evaluateSelfMonitoring([
      check({ domain: "security", status: "fail", severity: "critical", summary: "RBAC policy failed" }),
    ], 10);

    expect(report.decision).toBe("DENY");
    expect(report.findings[0]?.recommendedAction).toBe("block_sensitive_execution_and_alert");
  });

  it("fails closed when audit integrity fails", () => {
    const report = evaluateSelfMonitoring([
      check({ domain: "audit", status: "fail", severity: "critical", summary: "Audit chain verification failed" }),
    ], 10);

    expect(report.decision).toBe("DENY");
    expect(report.findings[0]?.recommendedAction).toBe("fail_closed_and_alert");
  });

  it("holds when a check is unknown or required evidence is missing", () => {
    const unknown = evaluateSelfMonitoring([
      check({ status: "unknown", summary: "Database status unavailable" }),
    ], 10);
    const missingEvidence = evaluateSelfMonitoring([
      check({ domain: "evidence", status: "fail", summary: "Release evidence missing" }),
    ], 10);

    expect(unknown.decision).toBe("HOLD");
    expect(missingEvidence.decision).toBe("HOLD");
    expect(missingEvidence.findings[0]?.recommendedAction).toBe("hold_for_evidence");
  });

  it("prioritizes DENY over HOLD when multiple findings exist", () => {
    const report = evaluateSelfMonitoring([
      check({ id: "health.unknown", status: "unknown" }),
      check({ id: "security.rls", domain: "security", status: "fail", severity: "critical" }),
    ], 10);

    expect(report.decision).toBe("DENY");
    expect(report.findings).toHaveLength(2);
  });

  it("redacts secret-like values from summaries", () => {
    const report = evaluateSelfMonitoring([
      check({ status: "fail", summary: "api_key=sk-abcdefghijklmnopqrstuvwxyz must never be retained" }),
    ], 10);

    expect(report.findings[0]?.summary).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(report.findings[0]?.summary).toContain("[REDACTED]");
  });

  it("rejects duplicate check identifiers and invalid timestamps", () => {
    expect(() => evaluateSelfMonitoring([check(), check()], 10)).toThrow("monitor_check_invalid");
    expect(() => evaluateSelfMonitoring([], -1)).toThrow("monitor_timestamp_invalid");
  });

  it("does not create findings for passing checks", () => {
    const report = evaluateSelfMonitoring([check({ status: "pass" })], 10);
    expect(report.findings).toHaveLength(0);
    expect(report.decision).toBe("PASS");
  });
});
