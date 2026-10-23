export function summarizeTrivyReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Trivy report must be a JSON object");
  }
  if (report.SchemaVersion !== 2) throw new Error("unsupported or missing Trivy SchemaVersion");
  if (typeof report.ArtifactName !== "string" || report.ArtifactName.length === 0) {
    throw new Error("Trivy report is missing ArtifactName");
  }
  if (typeof report.ArtifactType !== "string" || report.ArtifactType.length === 0) {
    throw new Error("Trivy report is missing ArtifactType");
  }
  if (!Array.isArray(report.Results) && report.Results !== null) {
    throw new Error("Trivy report Results must be an array or null");
  }

  const counts = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const blockers = [];
  for (const result of report.Results ?? []) {
    if (!result || typeof result !== "object") throw new Error("invalid Trivy result entry");
    if (result.Vulnerabilities !== undefined && result.Vulnerabilities !== null && !Array.isArray(result.Vulnerabilities)) {
      throw new Error("invalid Vulnerabilities collection in Trivy result");
    }
    for (const vulnerability of result.Vulnerabilities ?? []) {
      const severity = String(vulnerability?.Severity ?? "UNKNOWN").toUpperCase();
      if (!(severity in counts)) counts.UNKNOWN++;
      else counts[severity]++;
      if (severity === "HIGH" || severity === "CRITICAL") {
        blockers.push({
          id: String(vulnerability?.VulnerabilityID ?? "unknown"),
          severity,
          packageName: String(vulnerability?.PkgName ?? "unknown"),
          installedVersion: String(vulnerability?.InstalledVersion ?? "unknown"),
          fixedVersion: String(vulnerability?.FixedVersion ?? ""),
          target: String(result.Target ?? "unknown"),
        });
      }
    }
  }
  return { schemaVersion: report.SchemaVersion, artifactName: report.ArtifactName, artifactType: report.ArtifactType, counts, blockers };
}
