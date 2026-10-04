export declare const SPECIALIST_AGENTS: readonly ["research", "analysis", "engineering", "qa", "video_producer"];
export type SpecialistAgent = (typeof SPECIALIST_AGENTS)[number];
export declare const CLASSIFICATIONS: readonly ["public", "internal", "sensitive", "restricted"];
export type Classification = (typeof CLASSIFICATIONS)[number];
export declare const TASK_STATUSES: readonly ["queued", "running", "awaiting_approval", "completed", "denied", "stopped", "failed"];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export declare const VIDEO_STATUSES: readonly ["draft", "awaiting_approval", "approved", "queued", "generating", "completed", "failed", "stopped"];
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
export declare const AGENT_TOOL_SCOPES: Record<SpecialistAgent, readonly string[]>;
export declare const DEFAULT_AGENT_TOOL: Record<SpecialistAgent, string>;
export declare const AGENT_LABELS: Record<SpecialistAgent, {
    label: string;
    detail: string;
}>;
export declare const DENIAL_REASONS: {
    readonly context_missing: "A required governance binding (identity, tenant, role, purpose, resource, scope, or nonce) was absent.";
    readonly agent_not_allowed: "The requested agent is not part of the authorised specialist set.";
    readonly operation_missing: "No operation was declared for the action.";
    readonly grant_expired: "The capability grant was expired or not yet valid at evaluation time.";
    readonly budget_tokens_invalid: "The token budget was outside the permitted range.";
    readonly budget_bytes_invalid: "The byte budget was outside the permitted range.";
    readonly grant_replay: "The grant nonce was already consumed; replay refused.";
    readonly tool_not_allowed: "The tool is outside the agent's declared tool scope.";
    readonly scope_binding: "The requested scope did not match the bound tool.";
    readonly approval_required: "A human approval is required before this action can be admitted.";
    readonly approval_binding: "The approval did not bind to this request, digest, or tenant.";
    readonly approval_expired: "The approval window elapsed before execution.";
    readonly approval_replay: "The approval nonce was already consumed; replay refused.";
    readonly safety_interlock: "The kill switch or circuit breaker is engaged; the system is fail-closed.";
    readonly governance_failure: "The action failed governance evaluation.";
};
export type DenialReason = keyof typeof DENIAL_REASONS;
//# sourceMappingURL=types.d.ts.map