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

  it("rejects unknown fields, invalid inputs, and unknown tool names", async () => {
    await expect(executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 1, path: "../../etc/passwd" })).rejects.toThrow("agent_tool_parameters_invalid");
    await expect(executeReadOnlyAgentTool(ctx, "files.read", { artifactId: 0 })).rejects.toThrow("agent_tool_parameters_invalid");
    await expect(executeReadOnlyAgentTool(ctx, "documents.search", { query: "   " })).rejects.toThrow("agent_tool_parameters_invalid");
    await expect(executeReadOnlyAgentTool(ctx, "exec.command", {})).rejects.toThrow("unsupported_read_only_agent_tool");
  });
});

[executed on device: cloud-pc-6nly3e7f (c1e53d3a-bb1c-4963-9a97-d44ce659fb63)]