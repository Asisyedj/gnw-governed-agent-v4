import { canonicalize, sha256 } from "./security.js";

export type MonitorStatus = "pass" | "fail" | "unknown";
export type MonitorSeverity = "info" | "low" | "medium" | "high" | "critical";
export type MonitorDomain = "security" | "audit" | "evidence" | "operational";
export type MonitorDecision = "PASS" | "HOLD" | "DENY";

export interface SelfMonitoringCheck {
  id: string;
  domain: MonitorDomain;
  status: MonitorStatus;
  severity: MonitorSeverity;
  summary: string;
  evidenceRef?: string;
}

export interface MonitoringFinding {
  readonly checkId: string;
  readonly domain: MonitorDomain;
  readonly status: Exclude<MonitorStatus, "pass">;
  readonly severity: MonitorSeverity;
  readonly summary: string;
  readonly evidenceRef?: string;
  readonly recommendedAction:
    | "block_sensitive_execution_and_alert"
    | "fail_closed_and_alert"
    | "hold_for_evidence"
    | "alert_and_investigate";
}

export interface SelfMonitoringReport {
  readonly schema: "GNW.SelfMonitoringReport.v1";
  readonly evaluatedAt: number;
  readonly decision: MonitorDecision;
  readonly findings: readonly MonitoringFinding[];
  readonly digest: string;
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const EVIDENCE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const SECRET_PATTERNS = [
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key)\b\s*[:=]\s*)[^\s,;]+/gi,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
];

function redactSummary(value: string): string {
  let redacted = value.slice(0, 500);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "$1[REDACTED]");
  }
  return redacted;
}

function actionFor(domain: MonitorDomain): MonitoringFinding["recommendedAction"] {
  switch (domain) {
    case "security":
      return "block_sensitive_execution_and_alert";
    case "audit":
      return "fail_closed_and_alert";
    case "evidence":
      return "hold_for_evidence";
    case "operational":
      return "alert_and_investigate";
  }
}

/**
 * Evaluate normalized monitoring checks without performing mutations.
 *
 * Security-boundary and audit failures deny sensitive execution. Unknown checks
 * and missing evidence hold the decision. The monitor cannot change policies,
 * disable controls, or execute a repair.
 */
export function evaluateSelfMonitoring(
  checks: readonly SelfMonitoringCheck[],
  evaluatedAt = Date.now(),
): SelfMonitoringReport {
  if (!Number.isSafeInteger(evaluatedAt) || evaluatedAt < 0) {
    throw new Error("monitor_timestamp_invalid");
  }
  if (!Array.isArray(checks) || checks.length > 500) {
    throw new Error("monitor_checks_invalid");
  }

  const seen = new Set<string>();
  const findings: MonitoringFinding[] = [];
  let decision: MonitorDecision = "PASS";

  for (const check of checks) {
    if (
      !check ||
      typeof check.id !== "string" ||
      !ID_PATTERN.test(check.id) ||
      seen.has(check.id) ||
      !["security", "audit", "evidence", "operational"].includes(check.domain) ||
      !["pass", "fail", "unknown"].includes(check.status) ||
      !["info", "low", "medium", "high", "critical"].includes(check.severity) ||
      typeof check.summary !== "string" ||
      check.summary.trim().length === 0
    ) {
      throw new Error("monitor_check_invalid");
    }
    seen.add(check.id);

    if (check.evidenceRef !== undefined && !EVIDENCE_REF_PATTERN.test(check.evidenceRef)) {
      throw new Error("monitor_evidence_ref_invalid");
    }
    if (check.status === "pass") continue;

    const recommendedAction = actionFor(check.domain);
    const finding: MonitoringFinding = {
      checkId: check.id,
      domain: check.domain,
      status: check.status,
      severity: check.severity,
      summary: redactSummary(check.summary),
      recommendedAction,
      ...(check.evidenceRef === undefined ? {} : { evidenceRef: check.evidenceRef }),
    };
    findings.push(Object.freeze(finding));

    if (
      check.status === "fail" &&
      (check.domain === "security" || check.domain === "audit")
    ) {
      decision = "DENY";
    } else if (decision !== "DENY") {
      decision = "HOLD";
    }
  }

  const frozenFindings = Object.freeze(findings);
  const payload = {
    schema: "GNW.SelfMonitoringReport.v1" as const,
    evaluatedAt,
    decision,
    findings: frozenFindings,
  };
  return Object.freeze({
    ...payload,
    digest: sha256(canonicalize(payload)),
  });
}
