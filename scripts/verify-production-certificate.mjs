#!/usr/bin/env node
/**
 * Structural verifier for reviewed release evidence. This is not a certifying
 * authority and intentionally does not manufacture missing runtime evidence.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)=(.*)$/.exec(arg);
  if (!match) throw new Error(`invalid_argument:${arg.split("=")[0]}`);
  return [match[1], match[2]];
}));
for (const key of Object.keys(args)) if (!new Set(["evidence", "output"]).has(key)) throw new Error(`unknown_argument:${key}`);

const evidencePath = resolve(process.cwd(), args.evidence ?? "certification/evidence.json");
const outputPath = resolve(process.cwd(), args.output ?? "certification/verification-result.json");
const requiredGates = [
  "sourceIdentity", "reproducibleBuild", "automatedTests", "databaseRls",
  "approvalAndReplayControls", "tenLiveIntegrations", "liveEndToEndMission",
  "backupRestoreDrill", "stagingRollbackDrill", "securityAssessment",
  "supplyChainProvenance", "observabilityAndRunbooks",
];

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}

let evidence;
let outcome = { schemaVersion: 1, status: "DENY", evidencePath, verifiedAt: new Date().toISOString() };
try {
  evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  requireValue(evidence.schemaVersion === 1, "evidence_schema_version_invalid");
  requireValue(typeof evidence.candidate?.commitSha === "string" && /^[a-f0-9]{40}$/.test(evidence.candidate.commitSha), "candidate_commit_sha_invalid");
  requireValue(typeof evidence.candidate?.artifactSha256 === "string" && /^[a-f0-9]{64}$/.test(evidence.candidate.artifactSha256), "candidate_artifact_sha256_invalid");
  requireValue(typeof evidence.candidate?.gitClean === "boolean" && evidence.candidate.gitClean, "candidate_worktree_not_clean");
  requireValue(typeof evidence.environment?.id === "string" && evidence.environment.id.trim().length > 0, "environment_id_missing");
  requireValue(evidence.environment?.type === "staging", "evidence_environment_must_be_staging");
  requireValue(typeof evidence.scope === "string" && evidence.scope.trim().length > 0, "certification_scope_missing");

  const actualSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  requireValue(actualSha === evidence.candidate.commitSha, "evidence_commit_does_not_match_checked_out_source");

  for (const gateName of requiredGates) {
    const gate = evidence.gates?.[gateName];
    requireValue(gate?.status === "PASS", `required_gate_not_passed:${gateName}`);
    requireValue(typeof gate?.evidenceRef === "string" && gate.evidenceRef.trim().length > 0, `gate_evidence_reference_missing:${gateName}`);
    requireValue(typeof gate?.verifiedAt === "string" && !Number.isNaN(Date.parse(gate.verifiedAt)), `gate_verification_timestamp_missing:${gateName}`);
  }

  const review = evidence.independentReview;
  requireValue(review?.decision === "APPROVE" && review.approved === true, "independent_review_not_approved");
  requireValue(typeof review.reviewer === "string" && review.reviewer.trim().length > 0, "independent_reviewer_missing");
  requireValue(typeof evidence.releaseOwner === "string" && evidence.releaseOwner.trim().length > 0, "release_owner_missing");
  requireValue(review.reviewer !== evidence.releaseOwner, "independent_reviewer_must_differ_from_release_owner");
  requireValue(typeof review.reviewedAt === "string" && !Number.isNaN(Date.parse(review.reviewedAt)), "independent_review_timestamp_invalid");
  requireValue(typeof review.decisionEvidenceRef === "string" && review.decisionEvidenceRef.trim().length > 0, "independent_review_evidence_missing");

  outcome = {
    schemaVersion: 1,
    status: "EVIDENCE_COMPLETE_FOR_INDEPENDENT_RELEASE_AUTHORIZATION",
    candidate: evidence.candidate,
    environment: evidence.environment,
    scope: evidence.scope,
    requiredGates: requiredGates.map((name) => ({ name, status: "PASS", evidenceRef: evidence.gates[name].evidenceRef })),
    independentReviewer: review.reviewer,
    verifiedAt: new Date().toISOString(),
    limitation: "This tool validates the supplied evidence structure; it does not independently reproduce external tests, verify cloud state, or issue an accredited certification.",
  };
  console.log("Certification evidence structure PASS. Human release authority remains responsible for the defined scope.");
} catch (error) {
  outcome.error = error instanceof Error ? error.message : String(error);
  console.error(`Certification evidence DENY: ${outcome.error}`);
  process.exitCode = 1;
}

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(outcome, null, 2)}\n`, { mode: 0o600 });
