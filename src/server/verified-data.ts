import { canonicalize, sha256 } from "./security.js";

declare const SHA256_BRAND: unique symbol;
declare const TENANT_BRAND: unique symbol;
declare const TASK_BRAND: unique symbol;
declare const REQUEST_BRAND: unique symbol;
declare const EVIDENCE_BRAND: unique symbol;

export type Sha256Digest = string & { readonly [SHA256_BRAND]: "sha256" };
export type TenantId = number & { readonly [TENANT_BRAND]: "tenant-id" };
export type TaskId = number & { readonly [TASK_BRAND]: "task-id" };
export type RequestId = string & { readonly [REQUEST_BRAND]: "request-id" };
export type EvidenceId = string & { readonly [EVIDENCE_BRAND]: "evidence-id" };

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
  T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
  T;

export type VerificationSeverity = "error";
export type InvariantViolation = Readonly<{
  code: string;
  path: string;
  message: string;
  severity: VerificationSeverity;
}>;

export type VerificationReport = Readonly<{
  ok: boolean;
  subject: string;
  invariants: readonly string[];
  violations: readonly InvariantViolation[];
  digest: Sha256Digest;
}>;

export type EvidenceRecord = Readonly<{
  id: EvidenceId;
  tenantId: TenantId;
  sourceUri: string;
  sourceVersion: string;
  contentHash: Sha256Digest;
  chunkHash: Sha256Digest;
  chunkIndex: number;
  authorizationDigest: Sha256Digest;
  permissionContext: string;
  observedAt: string;
  expiresAt?: string;
  quote?: string;
}>;

export type RetrievedEvidenceSet = Readonly<{
  queryDigest: Sha256Digest;
  tenantId: TenantId;
  evidence: readonly EvidenceRecord[];
  retrievalDigest: Sha256Digest;
}>;

export type GroundedAnswer = Readonly<{
  tenantId: TenantId;
  queryDigest: Sha256Digest;
  answer: string;
  citations: readonly EvidenceId[];
  generationDigest: Sha256Digest;
  uncertainty: "low" | "medium" | "high";
}>;

export type DataStage<I, O> = Readonly<{
  stage: string;
  input: DeepReadonly<I>;
  output: DeepReadonly<O>;
  inputDigest: Sha256Digest;
  outputDigest: Sha256Digest;
  operationDigest: Sha256Digest;
}>;

function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value as DeepReadonly<T>;
}

function digest(value: unknown): Sha256Digest {
  return sha256(canonicalize(value)) as Sha256Digest;
}

export function asSha256(value: string): Sha256Digest {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("invalid_sha256_digest");
  return value as Sha256Digest;
}

export function asTenantId(value: number): TenantId {
  if (!Number.isInteger(value) || value <= 0) throw new Error("invalid_tenant_id");
  return value as TenantId;
}

export function asTaskId(value: number): TaskId {
  if (!Number.isInteger(value) || value <= 0) throw new Error("invalid_task_id");
  return value as TaskId;
}

export function asRequestId(value: string): RequestId {
  if (!value.trim() || value.length > 128) throw new Error("invalid_request_id");
  return value as RequestId;
}

export function asEvidenceId(value: string): EvidenceId {
  if (!/^ev-[A-Za-z0-9._:-]{1,120}$/.test(value)) throw new Error("invalid_evidence_id");
  return value as EvidenceId;
}

export function immutable<T>(value: T): DeepReadonly<T> {
  return freeze(structuredClone(value));
}

export function verifyInvariantSet(
  subject: string,
  invariants: ReadonlyArray<readonly [string, boolean, string]>,
): VerificationReport {
  const violations: InvariantViolation[] = [];
  for (const [code, holds, message] of invariants) {
    if (!holds) violations.push({ code, path: subject, message, severity: "error" });
  }
  const report = {
    ok: violations.length === 0,
    subject,
    invariants: invariants.map(([code]) => code),
    violations: Object.freeze(violations),
  };
  return immutable({ ...report, digest: digest(report) }) as VerificationReport;
}

export function verifyEvidenceRecord(record: EvidenceRecord): VerificationReport {
  const contentHash = digest({ sourceUri: record.sourceUri, sourceVersion: record.sourceVersion, quote: record.quote ?? "" });
  return verifyInvariantSet("evidence", [
    ["evidence.id", /^ev-/.test(record.id), "evidence id must be namespaced"],
    ["evidence.tenant", Number.isInteger(record.tenantId) && record.tenantId > 0, "tenant binding is required"],
    ["evidence.source", record.sourceUri.startsWith("https://") || record.sourceUri.startsWith("file://"), "source URI must be explicit"],
    ["evidence.source-version", record.sourceVersion.trim().length > 0, "source version is required"],
    ["evidence.content-hash", /^[0-9a-f]{64}$/.test(record.contentHash), "content hash must be sha256"],
    ["evidence.chunk-hash", /^[0-9a-f]{64}$/.test(record.chunkHash), "chunk hash must be sha256"],
    ["evidence.chunk-index", Number.isInteger(record.chunkIndex) && record.chunkIndex >= 0, "chunk index must be non-negative"],
    ["evidence.authorization", /^[0-9a-f]{64}$/.test(record.authorizationDigest), "authorization digest is required"],
    ["evidence.permission-context", record.permissionContext.trim().length > 0, "permission context is required"],
    ["evidence.observed-at", !Number.isNaN(Date.parse(record.observedAt)), "observedAt must be an ISO timestamp"],
    ["evidence.self-consistent-hash", contentHash === record.contentHash, "content hash does not match recorded provenance"],
    ["evidence.quote-or-source", Boolean(record.quote?.trim()) || record.sourceUri.length > 0, "evidence needs a source or quote"],
  ]);
}

export function verifyRetrieval(input: Readonly<{
  queryDigest: Sha256Digest;
  tenantId: TenantId;
  evidence: readonly EvidenceRecord[];
  allowedEvidenceIds?: readonly EvidenceId[];
}>): RetrievedEvidenceSet {
  const frozen = immutable(input);
  const violations: readonly [string, boolean, string][] = [
    ["retrieval.tenant", input.tenantId > 0, "retrieval tenant is required"],
    ["retrieval.query-digest", /^[0-9a-f]{64}$/.test(input.queryDigest), "query digest must be sha256"],
    ["retrieval.non-empty", input.evidence.length > 0, "retrieval must not produce an empty evidence set"],
    ["retrieval.same-tenant", input.evidence.every(item => item.tenantId === input.tenantId), "cross-tenant evidence is forbidden"],
    ["retrieval.unique-evidence", new Set(input.evidence.map(item => item.id)).size === input.evidence.length, "duplicate evidence ids are forbidden"],
    ["retrieval.authorized-set", !input.allowedEvidenceIds || input.evidence.every(item => input.allowedEvidenceIds!.includes(item.id)), "evidence is outside the authorized set"],
    ["retrieval.records-valid", input.evidence.every(item => verifyEvidenceRecord(item).ok), "one or more evidence records failed verification"],
  ];
  const report = verifyInvariantSet("retrieval", violations);
  if (!report.ok) throw new Error(report.violations.map(v => v.code).join(","));
  const retrievalDigest = digest({ queryDigest: input.queryDigest, evidence: frozen.evidence });
  return immutable({ queryDigest: input.queryDigest, tenantId: input.tenantId, evidence: frozen.evidence, retrievalDigest }) as RetrievedEvidenceSet;
}

export function verifyGroundedAnswer(
  input: Readonly<{
    tenantId: TenantId;
    queryDigest: Sha256Digest;
    answer: string;
    citations: readonly EvidenceId[];
    evidence: RetrievedEvidenceSet;
    uncertainty: "low" | "medium" | "high";
  }>,
): GroundedAnswer {
  const evidenceIds = new Set(input.evidence.evidence.map(item => item.id));
  const violations: readonly [string, boolean, string][] = [
    ["generation.tenant", input.tenantId === input.evidence.tenantId, "answer tenant differs from retrieval tenant"],
    ["generation.query", input.queryDigest === input.evidence.queryDigest, "answer query differs from retrieval query"],
    ["generation.non-empty", input.answer.trim().length > 0, "answer must not be empty"],
    ["generation.citations-required", input.citations.length > 0, "grounded answer requires citations"],
    ["generation.citations-unique", new Set(input.citations).size === input.citations.length, "duplicate citations are forbidden"],
    ["generation.citations-in-evidence", input.citations.every(id => evidenceIds.has(id)), "answer cites evidence outside the verified retrieval set"],
    ["generation.citation-coverage", input.citations.length >= Math.min(3, input.evidence.evidence.length), "answer citation coverage is insufficient"],
    ["generation.uncertainty", ["low", "medium", "high"].includes(input.uncertainty), "uncertainty label is required"],
  ];
  const report = verifyInvariantSet("generation", violations);
  if (!report.ok) throw new Error(report.violations.map(v => v.code).join(","));
  const generationDigest = digest({
    tenantId: input.tenantId,
    queryDigest: input.queryDigest,
    answer: input.answer,
    citations: input.citations,
    retrievalDigest: input.evidence.retrievalDigest,
    uncertainty: input.uncertainty,
  });
  return immutable({
    tenantId: input.tenantId,
    queryDigest: input.queryDigest,
    answer: input.answer,
    citations: input.citations,
    generationDigest,
    uncertainty: input.uncertainty,
  }) as GroundedAnswer;
}

export function verifyDataStage<I, O>(
  stage: string,
  input: I,
  output: O,
  extraInvariants: ReadonlyArray<readonly [string, boolean, string]> = [],
): DataStage<I, O> {
  if (!stage.trim()) throw new Error("stage_name_required");
  const inputDigest = digest(input);
  const outputDigest = digest(output);
  const report = verifyInvariantSet(stage, [
    ["stage.input-digest", /^[0-9a-f]{64}$/.test(inputDigest), "input digest is invalid"],
    ["stage.output-digest", /^[0-9a-f]{64}$/.test(outputDigest), "output digest is invalid"],
    ...extraInvariants,
  ]);
  if (!report.ok) throw new Error(report.violations.map(v => v.code).join(","));
  return immutable({
    stage,
    input: immutable(input),
    output: immutable(output),
    inputDigest,
    outputDigest,
    operationDigest: digest({ stage, inputDigest, outputDigest, invariants: report.invariants }),
  }) as DataStage<I, O>;
}
