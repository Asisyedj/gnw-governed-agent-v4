import { randomUUID } from "node:crypto";
import { canonicalize, sha256, verifyGrantSignature } from "./security.js";
import { issueCapabilityLease, type CapabilityLease } from "./capability.js";
import { AGENT_TOOL_SCOPES, CLASSIFICATIONS, SPECIALIST_AGENTS, type Classification, type SpecialistAgent } from "../shared/types.js";

export type GovernanceRequest = {
  requestId: string; subject: string; tenant: string; role: string; purpose: string;
  classification: Classification; operation: string; resource: string;
  agent: SpecialistAgent; tool: string; scope: string;
  budgetTokens: number; budgetBytes: number;
  issuedAt: number; expiresAt: number; nonce: string;
  taskId?: number; normalizedParameters?: Record<string, unknown>;
  inputDigest?: string; providerParameters?: Record<string, unknown>;
  provenance?: Record<string, { value: unknown; source: string; trust: string }>;
  capability?: string; outputConstraints?: Record<string, unknown>;
  budgetReservationTokens?: number; budgetReservationBytes?: number;
  issuer?: string; signature?: string;
};

export type ApprovalRecord = {
  approvalId: string | number; requestId?: string; actionDigest: string;
  tenant: string; status: "pending" | "approved" | "denied" | "expired";
  approverId?: number | string; approverRole?: string; requestedBy?: number | string;
  expiresAt: number; nonce: string;
};

export type GovernanceDecision = {
  allowed: boolean; status: "ALLOW" | "DENY" | "STOP";
  reason: string; actionDigest: string; requestId: string;
  capabilityLease?: CapabilityLease;
};

export type Interlock = { killSwitch: boolean; circuitOpen: boolean; generation?: number };

export class GovernanceError extends Error {
  constructor(public readonly code: string, message = code) { super(message); this.name = "GovernanceError"; }
}

export interface GovernanceStores {
  claimNonce(kind: string, nonce: string, taskId?: number): Promise<boolean>;
  reserveBudget?(taskId: number, grantNonce: string, tokens: number, bytes: number): Promise<boolean>;
  getInterlock(): Promise<Interlock>;
  persistCapabilityLease?(lease: CapabilityLease): Promise<unknown>;
}

export type GovernanceLimits = { maxBudgetTokens: number; maxBudgetBytes: number; maxGrantTtlMs: number };
const DEFAULT_LIMITS: GovernanceLimits = { maxBudgetTokens: 100_000, maxBudgetBytes: 50_000_000, maxGrantTtlMs: 600_000 };

export function requiresHumanApproval(request: Pick<GovernanceRequest, "operation" | "classification" | "agent" | "tool">) {
  return request.operation === "provider_job" || request.classification === "restricted" || request.tool === "video.provider_job";
}

export function digestRequest(request: GovernanceRequest): string {
  return sha256(`GNW-ACTION-ENVELOPE-V1|${canonicalize({
    requestId: request.requestId, subject: request.subject, tenant: request.tenant, role: request.role,
    purpose: request.purpose, classification: request.classification, operation: request.operation,
    resource: request.resource, agent: request.agent, tool: request.tool, scope: request.scope,
    normalizedParameters: request.normalizedParameters ?? {}, inputDigest: request.inputDigest ?? "",
    providerParameters: request.providerParameters ?? null, outputConstraints: request.outputConstraints ?? null,
    budgetTokens: request.budgetTokens, budgetBytes: request.budgetBytes,
    budgetReservationTokens: request.budgetReservationTokens ?? request.budgetTokens,
    budgetReservationBytes: request.budgetReservationBytes ?? request.budgetBytes,
    provenance: request.provenance ?? {},
  })}`);
}

export class GovernanceService {
  constructor(
    private readonly stores: GovernanceStores,
    private readonly limits: GovernanceLimits = DEFAULT_LIMITS,
    private readonly now: () => number = Date.now,
    private readonly grantVerifier?: { issuer: string; publicKeyPem: string },
    private readonly leaseSigner?: { issuer: string; privateKeyPem: string; ttlMs: number },
  ) {}

  digest(request: GovernanceRequest) { return digestRequest(request); }

  async authorize(request: GovernanceRequest, approval?: ApprovalRecord): Promise<GovernanceDecision> {
    const actionDigest = this.digest(request);
    const base = { actionDigest, requestId: request.requestId };
    let interlock: Interlock;
    try { interlock = await this.stores.getInterlock(); } catch { return { allowed: false, status: "STOP", reason: "safety_interlock", ...base }; }
    if (interlock.killSwitch || interlock.circuitOpen) return { allowed: false, status: "STOP", reason: "safety_interlock", ...base };
    try {
      this.assertBoundContext(request);
      if (this.grantVerifier) {
        if (request.issuer !== this.grantVerifier.issuer || !request.signature || !verifyGrantSignature(request as unknown as Record<string, unknown>, request.issuer, request.signature, this.grantVerifier.publicKeyPem))
          throw new GovernanceError("invalid_grant_signature");
      }
      const now = this.now();
      if (!Number.isInteger(request.issuedAt) || !Number.isInteger(request.expiresAt)) throw new GovernanceError("grant_time_invalid");
      if (request.expiresAt <= request.issuedAt || request.expiresAt - request.issuedAt > this.limits.maxGrantTtlMs || now < request.issuedAt || now >= request.expiresAt) throw new GovernanceError("grant_expired");
      if (!Number.isInteger(request.budgetTokens) || request.budgetTokens <= 0 || request.budgetTokens > this.limits.maxBudgetTokens) throw new GovernanceError("budget_tokens_invalid");
      if (!Number.isInteger(request.budgetBytes) || request.budgetBytes <= 0 || request.budgetBytes > this.limits.maxBudgetBytes) throw new GovernanceError("budget_bytes_invalid");
      const reserveTokens = request.budgetReservationTokens ?? request.budgetTokens;
      const reserveBytes = request.budgetReservationBytes ?? request.budgetBytes;
      if (!Number.isInteger(reserveTokens) || reserveTokens <= 0 || reserveTokens > request.budgetTokens) throw new GovernanceError("budget_reservation_invalid");
      if (!Number.isInteger(reserveBytes) || reserveBytes <= 0 || reserveBytes > request.budgetBytes) throw new GovernanceError("budget_reservation_invalid");
      const scopes = AGENT_TOOL_SCOPES[request.agent] ?? [];
      if (!scopes.includes(request.tool)) throw new GovernanceError("tool_not_allowed");
      if (request.scope !== request.tool) throw new GovernanceError("scope_binding");
      if (requiresHumanApproval(request)) {
        if (!approval) throw new GovernanceError("approval_required");
        if (approval.status !== "approved") throw new GovernanceError("approval_required");
        if (approval.actionDigest !== actionDigest || approval.tenant !== request.tenant) throw new GovernanceError("approval_binding");
        if (approval.requestId && approval.requestId !== request.requestId) throw new GovernanceError("approval_binding");
        if (approval.expiresAt <= now) throw new GovernanceError("approval_expired");
        if (approval.approverId !== undefined && approval.requestedBy !== undefined && String(approval.approverId) === String(approval.requestedBy) && approval.approverRole !== "admin") throw new GovernanceError("separation_of_duties");
        if (!(await this.stores.claimNonce("approval", approval.nonce))) throw new GovernanceError("approval_replay");
      }
      if (!(await this.stores.claimNonce("grant", request.nonce))) throw new GovernanceError("grant_replay");
      if (request.taskId && this.stores.reserveBudget && !(await this.stores.reserveBudget(request.taskId, request.nonce, reserveTokens, reserveBytes))) throw new GovernanceError("aggregate_budget_exhausted");
      let capabilityLease: CapabilityLease | undefined;
      if (this.leaseSigner) {
        capabilityLease = issueCapabilityLease({
          requestId: request.requestId, actionDigest, subject: request.subject, tenant: request.tenant,
          taskId: request.taskId ?? 0, actorUserId: Number(request.subject),
          capability: request.capability ?? request.tool,
          destination: typeof request.providerParameters?.endpoint === "string" ? request.providerParameters.endpoint : null,
          ttlMs: Math.min(this.leaseSigner.ttlMs, Math.max(1, request.expiresAt - now)),
          interlockGeneration: interlock.generation ?? 0,
          issuer: this.leaseSigner.issuer, privateKeyPem: this.leaseSigner.privateKeyPem,
        }, now);
        if (this.stores.persistCapabilityLease) await this.stores.persistCapabilityLease(capabilityLease);
      }
      return { allowed: true, status: "ALLOW", reason: "governance_admitted", capabilityLease, ...base };
    } catch (error) {
      const reason = error instanceof GovernanceError ? error.code : "governance_failure";
      return { allowed: false, status: "DENY", reason, ...base };
    }
  }

  private assertBoundContext(request: GovernanceRequest) {
    const required = [request.requestId, request.subject, request.tenant, request.role, request.purpose, request.resource, request.agent, request.tool, request.scope, request.nonce];
    if (required.some(value => typeof value !== "string" || !value.trim())) throw new GovernanceError("context_missing");
    if (!SPECIALIST_AGENTS.includes(request.agent)) throw new GovernanceError("agent_not_allowed");
    if (!request.operation || !request.operation.trim()) throw new GovernanceError("operation_missing");
    if (!CLASSIFICATIONS.includes(request.classification)) throw new GovernanceError("classification_invalid");
    if (request.purpose.length > 200 || request.resource.length > 500 || request.tool.length > 200 || request.scope.length > 200) throw new GovernanceError("context_too_large");
    if (request.normalizedParameters !== undefined && (typeof request.normalizedParameters !== "object" || Array.isArray(request.normalizedParameters))) throw new GovernanceError("parameters_invalid");
  }
}

export class MemoryGovernanceStores implements GovernanceStores {
  private readonly used = new Set<string>();
  private interlock: Interlock = { killSwitch: false, circuitOpen: false, generation: 0 };
  async claimNonce(kind: string, nonce: string) { const key = `${kind}:${nonce}`; if (this.used.has(key)) return false; this.used.add(key); return true; }
  async reserveBudget() { return true; }
  async getInterlock() { return this.interlock; }
  setInterlock(next: Partial<Interlock>) { this.interlock = { ...this.interlock, ...next, generation: (this.interlock.generation ?? 0) + 1 }; }
}

export function newGrant(input: Omit<GovernanceRequest, "requestId" | "nonce" | "issuedAt" | "expiresAt"> & { ttlMs?: number }): GovernanceRequest {
  const issuedAt = Date.now() - 1;
  return { ...input, requestId: randomUUID(), nonce: randomUUID(), issuedAt, expiresAt: issuedAt + (input.ttlMs ?? 600_000) };
}
