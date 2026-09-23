export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "ApiError"; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const b = await res.json(); msg = b.error ?? b.message ?? msg; } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type MeResponse = { user: { id: number; email: string; role: string; tenantId: number } | null; bootstrap: boolean; allowSelfRegistration: boolean };
export type Summary = { tasks: TaskSummary[]; approvals: ApprovalSummary[]; interlock: { killSwitch: boolean; circuitOpen: boolean; generation: number }; stats: { total: number; running: number; done: number; failed: number } };
export type TaskSummary = { id: number; title: string; status: string; classification: string; createdAt: string; updatedAt: string };
export type ApprovalSummary = { id: number; taskId: number | null; actionDigest: string; status: string; expiresAt: string; createdAt: string };
export type Task = TaskSummary & { description: string | null; budgetTokensAllocated: number; budgetTokensUsed: number; budgetBytesAllocated: number; budgetBytesUsed: number; trajectoryRootHash: string | null; trajectorySteps: number; steps: StepSummary[] };
export type StepSummary = { id: number; stepIndex: number; agentRole: string; toolName: string; operation: string; status: string; durationMs: number | null; errorMessage: string | null };

export const api = {
  me: () => request<MeResponse>("/api/me"),
  login: (email: string, password: string) => request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string) => request<{ ok: boolean }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  summary: () => request<Summary>("/api/summary"),
  tasks: { list: () => request<Task[]>("/api/tasks"), get: (id: number) => request<Task>(`/api/tasks/${id}`), create: (body: { title: string; description?: string; classification?: string }) => request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }), cancel: (id: number) => request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: "POST" }) },
  approvals: { list: () => request<ApprovalSummary[]>("/api/approvals"), review: (id: number, status: "approved" | "denied", reason?: string) => request<{ ok: boolean }>(`/api/approvals/${id}`, { method: "PATCH", body: JSON.stringify({ status, reason }) }) },
  interlock: { get: () => request<{ killSwitch: boolean; circuitOpen: boolean; generation: number }>("/api/interlock"), set: (patch: { killSwitch?: boolean; circuitOpen?: boolean }) => request<{ ok: boolean }>("/api/interlock", { method: "PATCH", body: JSON.stringify(patch) }) },
  audit: { list: (limit?: number) => request<Record<string, unknown>[]>(`/api/audit?limit=${limit ?? 100}`) },
};
