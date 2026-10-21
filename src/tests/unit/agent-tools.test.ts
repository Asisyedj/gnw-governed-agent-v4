import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listArtifacts: vi.fn(),
  findTaskById: vi.fn(),
  storageGet: vi.fn(),
  createStorage: vi.fn(),
}));
vi.mock("../../server/repo.js", () => ({ listArtifacts: mocks.listArtifacts, findTaskById: mocks.findTaskById }));
vi.mock("../../server/storage.js", () => ({ createStorage: mocks.createStorage }));

import { executeReadOnlyAgentTool, isReadOnlyAgentTool } from "../../server/agent-tools.js";
import { loadEnv } from "../../server/env.js";

const content = Buffer.from("GNW governs safe agents. Documents provide evidence. Safe agents verify evidence.", "utf8");
const digest = createHash("sha256").update(content).digest("hex");
const artifact = { id: 7, tenantId: 20, taskId: 10, storageKey: "task/7.txt", filename: "evidence.txt", contentType: "text/plain", size: content.byteLength, sha256: digest };
const ctx = { db: {} as never, env: {} as never, taskId: 10, tenantId: 20 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listArtifacts.mockResolvedValue([artifact]);
  mocks.findTaskById.mockResolvedValue({ id: 10, status: "done", title: "GNW task", classification: "internal", createdAt: new Date(0), updatedAt: new Date(1), startedAt: null, completedAt: new Date(1), trajectorySteps: 1, trajectoryRootHash: "a".repeat(64) });
  mocks.storageGet.mockResolvedValue(content);
  mocks.createStorage.mockReturnValue({ get: mocks.storageGet });
});

describe("governed read-only agent tools", () => {
  it("registers the five requested capabilities and legacy aliases", () => {
    for (const tool of ["files.read", "documents.search", "documents.summarize", "knowledge.retrieve", "task.status", "file.read", "evidence.summarize", "knowledge.search"]) expect(isReadOnlyAgentTool(tool), tool).toBe(true);
    expect(isReadOnlyAgentTool("exec.command")).toBe(false);
    expect(isReadOnlyAgentTool("browser.navigate")).toBe(false);
  });

  it("reads only current-task text artifacts and verifies their digest", async () => {
    const result = await executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 7 }) as { content: string; sha256: string };
    expect(result.content).toBe(content.toString("utf8"));
    expect(result.sha256).toBe(digest);
    mocks.listArtifacts.mockResolvedValue([{ ...artifact, taskId: 99 }]);
    await expect(executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 7 })).rejects.toThrow("agent_tool_artifact_not_found");
    mocks.listArtifacts.mockResolvedValue([artifact]);
    mocks.storageGet.mockResolvedValue(Buffer.alloc(content.byteLength, "x"));
    await expect(executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 7 })).rejects.toThrow("agent_tool_artifact_digest_mismatch");
  });

  it("searches and summarizes task artifacts deterministically", async () => {
    const search = await executeReadOnlyAgentTool(ctx, "documents.search", { query: "evidence", limit: 3 }) as { results: Array<{ artifactId: number; score: number }> };
    expect(search.results[0]?.artifactId).toBe(7);
    expect(search.results[0]?.score).toBeGreaterThan(0);
    const summary = await executeReadOnlyAgentTool(ctx, "documents.summarize", { artifactId: 7, maxSentences: 2 }) as { method: string; summaries: Array<{ summary: string }> };
    expect(summary.method).toBe("deterministic_extractive");
    expect(summary.summaries[0]?.summary).toContain("evidence");
  });

  it("returns only the bound task status and refuses cross-task access", async () => {
    const status = await executeReadOnlyAgentTool(ctx, "task.status", {}) as { taskId: number; status: string };
    expect(status).toMatchObject({ taskId: 10, status: "done" });
    await expect(executeReadOnlyAgentTool(ctx, "task.status", { taskId: 11 })).rejects.toThrow("agent_tool_task_scope_denied");
    expect(mocks.findTaskById).toHaveBeenCalledWith(ctx.db, 10, 20);
  });

  it("runs bounded Perplexity-compatible deep research through the configured LLM client and filters citations", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      GNW_DEEP_RESEARCH_BASE_URL: "https://api.perplexity.ai",
      GNW_DEEP_RESEARCH_API_KEY: "test-only-key",
      GNW_DEEP_RESEARCH_MODEL: "sonar-deep-research",
      GNW_DEEP_RESEARCH_TIMEOUT_MS: "5000",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "A bounded evidence summary." } }],
      citations: ["https://research.example/source#section", "http://insecure.example/", "https://user:pass@credential.example/", "https://second.example/path"],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(isReadOnlyAgentTool("deep.research")).toBe(true);
      const result = await executeReadOnlyAgentTool({ ...ctx, env }, "deep.research", { query: "Research GNW governance architecture" }) as { answer: string; citations: string[]; model: string; usage: { totalTokens: number } };
      expect(result.answer).toBe("A bounded evidence summary.");
      expect(result.model).toBe("sonar-deep-research");
      expect(result.citations).toEqual(["https://research.example/source", "https://second.example/path"]);
      expect(result.usage.totalTokens).toBe(46);
      const request = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
      expect(request[0].toString()).toBe("https://api.perplexity.ai/chat/completions");
      expect((request[1].headers as Record<string, string>).Authorization).toBe("Bearer test-only-key");
      const body = JSON.parse(String(request[1].body)) as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
      expect(body.model).toBe("sonar-deep-research");
      expect(body.max_tokens).toBe(1536);
      expect(body.messages[0]?.content).toContain("untrusted data");
    } finally { vi.unstubAllGlobals(); }
  });

  it("fails closed when deep research credentials are missing", async () => {
    const env = loadEnv({ NODE_ENV: "test", GNW_DEEP_RESEARCH_API_KEY: "", LLM_API_KEY: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(executeReadOnlyAgentTool({ ...ctx, env }, "deep.research", { query: "Research GNW governance" })).rejects.toThrow("deep_research_api_key_missing");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects unknown fields, invalid inputs, and unknown tool names", async () => {
    await expect(executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 1, path: "../../etc/passwd" })).rejects.toThrow("agent_tool_parameters_invalid");
    await expect(executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 0 })).rejects.toThrow("agent_tool_parameters_invalid");
    await expect(executeReadOnlyAgentTool(ctx, "documents.search", { query: "   " })).rejects.toThrow("agent_tool_parameters_invalid");
    await expect(executeReadOnlyAgentTool(ctx, "exec.command", {})).rejects.toThrow("unsupported_read_only_agent_tool");
  });
});
