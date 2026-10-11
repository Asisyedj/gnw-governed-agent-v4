import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { createArtifact, findTaskById } from "./repo.js";
import type { Env } from "./env.js";
import { createStorage, type StorageObject } from "./storage.js";

const MAX_DOCUMENT_BYTES = 128 * 1024;
const docsWriteSchema = z.object({
  filename: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  contentType: z.enum(["text/plain", "text/markdown", "text/csv", "application/json"]),
  content: z.string().min(1).max(MAX_DOCUMENT_BYTES),
}).strict();

type DocsWriteContext = { db: Db; env: Env; taskId: number; tenantId: number; signal?: AbortSignal };

async function removePartialObject(storage: ReturnType<typeof createStorage>, storageKey: string) {
  try { await storage.delete(storageKey); }
  catch { throw new Error("docs_write_storage_cleanup_failed"); }
}

function parseInput(parameters: unknown) {
  const result = docsWriteSchema.safeParse(parameters ?? {});
  if (!result.success) throw new Error("docs_write_parameters_invalid");
  if (result.data.filename.includes("..")) throw new Error("docs_write_filename_invalid");
  const data = Buffer.from(result.data.content, "utf8");
  if (data.byteLength > MAX_DOCUMENT_BYTES) throw new Error("docs_write_content_too_large");
  if (result.data.contentType === "application/json") {
    try { JSON.parse(result.data.content); }
    catch { throw new Error("docs_write_json_invalid"); }
  }
  return { ...result.data, data };
}

export async function executeDocsWrite(ctx: DocsWriteContext, parameters: unknown) {
  const input = parseInput(parameters);
  if (ctx.signal?.aborted) throw new Error("execution_cancelled");
  const task = await findTaskById(ctx.db, ctx.taskId, ctx.tenantId);
  if (!task) throw new Error("docs_write_task_not_found");

  const storage = createStorage(ctx.env);
  const storageKey = `tasks/${ctx.taskId}/generated/${randomUUID()}`;
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  let stored: StorageObject;
  try {
    stored = await storage.put(storageKey, input.data, input.contentType);
  } catch (error) {
    // A storage backend may have persisted bytes before rejecting its put call.
    await removePartialObject(storage, storageKey);
    throw error;
  }
  if (stored.key !== storageKey || stored.size !== input.data.byteLength) {
    await removePartialObject(storage, storageKey);
    throw new Error("docs_write_storage_integrity_failure");
  }
  if (ctx.signal?.aborted) {
    await removePartialObject(storage, storageKey);
    throw new Error("execution_cancelled");
  }

  try {
    const artifact = await createArtifact(ctx.db, {
      tenantId: ctx.tenantId, taskId: ctx.taskId, storageKey, filename: input.filename,
      contentType: input.contentType, size: input.data.byteLength, sha256,
    });
    return { artifactId: artifact.id, taskId: ctx.taskId, filename: input.filename, contentType: input.contentType, size: input.data.byteLength, sha256 };
  } catch (error) {
    await removePartialObject(storage, storageKey);
    throw error;
  }
}
