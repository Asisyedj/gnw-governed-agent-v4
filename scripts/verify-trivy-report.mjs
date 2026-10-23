import { readFileSync } from "node:fs";
import { summarizeTrivyReport } from "./lib/trivy-report.mjs";

const reportPath = process.argv[2] ?? "trivy-results.json";
let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error("Trivy release gate: DENY; report is missing or invalid JSON:", error.message);
  process.exit(1);
}

let summary;
try {
  summary = summarizeTrivyReport(report);
} catch (error) {
  console.error("Trivy release gate: DENY;", error.message);
  process.exit(1);
}

console.log("Trivy report summary:", JSON.stringify({
  artifactName: summary.artifactName,
  artifactType: summary.artifactType,
  counts: summary.counts,
  highCriticalCount: summary.blockers.length
}, null, 2));

if (summary.blockers.length > 0) {
  console.error("Trivy release gate: DENY; HIGH/CRITICAL vulnerabilities found:");
  for (const blocker of summary.blockers) console.error(JSON.stringify(blocker));
  process.exit(1);
}
console.log("Trivy release gate: PASS; no HIGH/CRITICAL findings in the complete JSON report.");
