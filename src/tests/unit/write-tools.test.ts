import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createArtifact: vi.fn(), findTaskById: vi.fn(), createStorage: vi.fn(), storagePut: vi.fn(), storageDelete: vi.fn() }));
vi.mock("../../server/repo.js", () => ({ createArtifact: mocks.createArtifact, findTaskById: mocks.findTaskById }));
vi.mock("../../server/storage.js", () => ({ createStorage: mocks.createStorage }));
import { executeDocsWrite } from "../../server/write-tools.js";

const ctx = { db: {} as never, env: {} as never, taskId: 10, tenantId: 20 };
const input = { filename: "summary.md", contentType: "text/markdown", content: "# Verified summary\n" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTaskById.mockResolvedValue({ id: 10, tenantId: 20 });
  mocks.storagePut.mockImplementation(async (key: string, data: Buffer, contentType: string) => ({ key, size: data.byteLength, contentType, url: "local://artifact", uploadedAt: new Date(0) }));
  mocks.storageDelete.mockResolvedValue(undefined);
  mocks.createStorage.mockReturnValue({ put: mocks.storagePut, delete: mocks.storageDelete });
  mocks.createArtifact.mockImplementation(async (_db: unknown, value: { tenantId: number; taskId: number; filename: string; contentType: string; size: number; sha256: string }) => ({ id: 17, ...value }));
});

describe("governed internal docs.write", () => {
  it("stores a task-bound artifact and returns integrity metadata", async () => {
    const result = await executeDocsWrite(ctx, input);
    const data = Buffer.from(input.content, "utf8");
    expect(result).toEqual({ artifactId: 17, taskId: 10, filename: input.filename, contentType: input.contentType, size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") });
    expect(mocks.findTaskById).toHaveBeenCalledWith(ctx.db, 10, 20);
    expect(mocks.createArtifact).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ tenantId: 20, taskId: 10, filename: input.filename, size: data.byteLength }));
  });
  it("cleans partial storage if put writes then rejects", async () => {
    mocks.storagePut.mockRejectedValueOnce(new Error("storage_put_partial_failure"));
    await expect(executeDocsWrite(ctx, input)).rejects.toThrow("storage_put_partial_failure");
    expect(mocks.storageDelete).toHaveBeenCalledWith(expect.stringMatching(/^tasks\/10\/generated\//));
    expect(mocks.createArtifact).not.toHaveBeenCalled();
  });
  it("surfaces cleanup failure when put fails after a partial write", async () => {
    mocks.storagePut.mockRejectedValueOnce(new Error("storage_put_partial_failure"));
    mocks.storageDelete.mockRejectedValueOnce(new Error("storage_unavailable"));
    await expect(executeDocsWrite(ctx, input)).rejects.toThrow("docs_write_storage_cleanup_failed");
  });
  it("cleans up if artifact metadata persistence fails", async () => {
    mocks.createArtifact.mockRejectedValueOnce(new Error("database_unavailable"));
    await expect(executeDocsWrite(ctx, input)).rejects.toThrow("database_unavailable");
    expect(mocks.storageDelete).toHaveBeenCalledTimes(1);
  });
  it("denies a missing task before writing", async () => {
    mocks.findTaskById.mockResolvedValueOnce(null);
    await expect(executeDocsWrite(ctx, input)).rejects.toThrow("docs_write_task_not_found");
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
  it("rejects unsafe filenames, extra fields and invalid JSON", async () => {
    await expect(executeDocsWrite(ctx, { ...input, taskId: 99 })).rejects.toThrow("docs_write_parameters_invalid");
    await expect(executeDocsWrite(ctx, { ...input, filename: "report..md" })).rejects.toThrow("docs_write_filename_invalid");
    await expect(executeDocsWrite(ctx, { filename: "data.json", contentType: "application/json", content: "not-json" })).rejects.toThrow("docs_write_json_invalid");
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
});
