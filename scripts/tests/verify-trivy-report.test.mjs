import assert from "node:assert/strict";
import { summarizeTrivyReport } from "../lib/trivy-report.mjs";

const base = {
  SchemaVersion: 2,
  ArtifactName: "gnw-test-image",
  ArtifactType: "container_image",
  Results: [{ Target: "os-pkgs", Vulnerabilities: [] }]
};

const lowOnly = structuredClone(base);
lowOnly.Results[0].Vulnerabilities.push({
  VulnerabilityID: "CVE-TEST-LOW", Severity: "LOW", PkgName: "example", InstalledVersion: "1.0.0"
});
assert.equal(summarizeTrivyReport(lowOnly).blockers.length, 0);
assert.equal(summarizeTrivyReport(lowOnly).counts.LOW, 1);

const high = structuredClone(base);
high.Results[0].Vulnerabilities.push({
  VulnerabilityID: "CVE-TEST-HIGH", Severity: "HIGH", PkgName: "example", InstalledVersion: "1.0.0", FixedVersion: "1.0.1"
});
assert.equal(summarizeTrivyReport(high).blockers.length, 1);
assert.equal(summarizeTrivyReport(high).blockers[0].id, "CVE-TEST-HIGH");

const critical = structuredClone(base);
critical.Results[0].Vulnerabilities.push({ VulnerabilityID: "CVE-TEST-CRIT", Severity: "CRITICAL" });
assert.equal(summarizeTrivyReport(critical).blockers[0].severity, "CRITICAL");

assert.throws(() => summarizeTrivyReport({ Results: [] }), /SchemaVersion/);
assert.throws(() => summarizeTrivyReport({ ...base, Results: "not-an-array" }), /Results/);
console.log("Trivy report gate contract: PASS (synthetic fixtures only; not an image scan)");
