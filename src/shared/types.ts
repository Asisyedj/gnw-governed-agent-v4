export const SPECIALIST_AGENTS = ["research", "analysis", "engineering", "qa", "video_producer"] as const;
export type SpecialistAgent = (typeof SPECIALIST_AGENTS)[number];

export const CLASSIFICATIONS = ["public", "internal", "sensitive", "restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const TASK_STATUSES = ["queued", "running", "awaiting_approval", "completed", "denied", "stopped", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const VIDEO_STATUSES = ["draft", "awaiting_approval", "approved", "queued", "generating", "completed", "failed", "stopped"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const AGENT_TOOL_SCOPES: Record<SpecialistAgent, readonly string[]> = {
  research: [
    "knowledge.search", "evidence.summarize", "browser.fetch",
    "browser.visual", "browser.screenshot", "memory.query",
    "research.clarify", "research.prompt_rewrite", "deep.research", "deep.research.status"
  ],
  analysis: [
    "analysis.compare", "analysis.model", "memory.query"
  ],
  engineering: [
    "code.review", "code.plan", "exec.command", "exec.python",
    "file.read", "file.write", "file.patch", "file.list",
    "browser.visual", "browser.screenshot",
    "git.status", "git.diff", "git.commit", "git.branch", "github.pr",
    "memory.store", "memory.query", "code.symbols", "code.definition"
  ],
  qa: [
    "qa.evaluate", "qa.report", "exec.test",
    "browser.visual", "browser.screenshot", "code.symbols"
  ],
  video_producer: ["video.brief", "video.storyboard", "video.provider_job"],
};

export const DEFAULT_AGENT_TOOL: Record<SpecialistAgent, string> = {
  research: "knowledge.search",
  analysis: "analysis.compare",
  engineering: "code.plan",
  qa: "qa.evaluate",
  video_producer: "video.brief",
};

export const AGENT_LABELS: Record<SpecialistAgent, { label: string; detail: string }> = {
  research: { label: "Research", detail: "Evidence-first synthesis & web browsing" },
  analysis: { label: "Analysis", detail: "Compare, model, and reason" },
  engineering: { label: "Engineering", detail: "Sandboxed execution, code & file tools" },
  qa: { label: "QA", detail: "Adversarial verification & test execution" },
  video_producer: { label: "Video Producer", detail: "Brief, script, storyboard" },
};

export const DENIAL_REASONS = {
  context_missing: "A required governance binding (identity, tenant, role, purpose, resource, scope, or nonce) was absent.",
  agent_not_allowed: "The requested agent is not part of the authorised specialist set.",
  operation_missing: "No operation was declared for the action.",
  grant_expired: "The capability grant was expired or not yet valid at evaluation time.",
  budget_tokens_invalid: "The token budget was outside the permitted range.",
  budget_bytes_invalid: "The byte budget was outside the permitted range.",
  grant_replay: "The grant nonce was already consumed; replay refused.",
  tool_not_allowed: "The tool is outside the agent's declared tool scope.",
  scope_binding: "The requested scope did not match the bound tool.",
  approval_required: "A human approval is required before this action can be admitted.",
  approval_binding: "The approval did not bind to this request, digest, or tenant.",
  approval_expired: "The approval window elapsed before execution.",
  approval_replay: "The approval nonce was already consumed; replay refused.",
  safety_interlock: "The kill switch or circuit breaker is engaged; the system is fail-closed.",
  governance_failure: "The action failed governance evaluation.",
} as const;

export type DenialReason = keyof typeof DENIAL_REASONS;
