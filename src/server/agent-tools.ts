import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { findTaskById, listArtifacts } from "./repo.js";
import { createStorage } from "./storage.js";

type ReadOnlyContext = { db: Db; env: Env; taskId: number; tenantId: number };
const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_SEARCH_ARTIFACTS = 40;
const MAX_SEARCH_TOTAL_BYTES = 512 * 1024;
const textTypes = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "application/xml"]);

const fileReadSchema = z.object({ artifactId: z.number().int().positive(), maxBytes: z.number().int().min(1).max(MAX_ARTIFACT_BYTES).optional() }).strict();
const searchSchema = z.object({ query: z.string().trim().min(1).max(300), limit: z.number().int().min(1).max(10).optional() }).strict();
const summarizeSchema = z.object({ artifactId: z.number().int().positive().optional(), maxSentences: z.number().int().min(1).max(12).optional() }).strict();
const retrieveSchema = z.object({ query: z.string().trim().min(1).max(300), limit: z.number().int().min(1).max(10).optional() }).strict();
const taskStatusSchema = z.object({ taskId: z.number().int().positive().optional() }).strict();

export function isReadOnlyAgentTool(tool: string): boolean {
  return ["files.read", "file.read", "documents.search", "documents.summarize", "evidence.summarize", "knowledge.retrieve", "knowledge.search", "task.status"].includes(tool);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new Error("agent_tool_parameters_invalid");
  return result.data;
}

async function currentArtifacts(ctx: ReadOnlyContext) {
  const rows = await listArtifacts(ctx.db, ctx.taskId, ctx.tenantId);
  return rows.filter(row => row.taskId === ctx.taskId && row.tenantId === ctx.tenantId).slice(0, MAX_SEARCH_ARTIFACTS);
}

function isTextContentType(contentType: string) {
  return textTypes.has((contentType.toLowerCase().split(";")[0] ?? "").trim());
}

function ensureTextArtifact(row: { contentType: string; size: number }) {
  if (!isTextContentType(row.contentType)) throw new Error("agent_tool_artifact_not_text");
  if (!Number.isSafeInteger(row.size) || row.size < 0 || row.size > MAX_ARTIFACT_BYTES) throw new Error("agent_tool_artifact_size_limit");
}

async function readArtifact(ctx: ReadOnlyContext, artifactId: number, maxBytes = MAX_ARTIFACT_BYTES) {
  const row = (await currentArtifacts(ctx)).find(item => item.id === artifactId);
  if (!row) throw new Error("agent_tool_artifact_not_found");
  ensureTextArtifact(row);
  if (row.size > maxBytes) throw new Error("agent_tool_artifact_size_limit");
  const data = await createStorage(ctx.env).get(row.storageKey);
  if (data.byteLength !== row.size) throw new Error("agent_tool_artifact_size_mismatch");
  const digest = createHash("sha256").update(data).digest("hex");
  if (digest !== row.sha256.toLowerCase()) throw new Error("agent_tool_artifact_digest_mismatch");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new Error("agent_tool_artifact_invalid_utf8"); }
  return { artifactId: row.id, filename: row.filename, contentType: row.contentType, size: row.size, sha256: digest, content };
}

function terms(query: string) { return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].slice(0, 30); }
function snippet(text: string, queryTerms: string[], max = 320) {
  const lower = text.toLowerCase();
  const positions = queryTerms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 80) : 0;
  // eslint-disable-next-line no-control-regex -- sanitize control bytes from untrusted artifact text.
  const excerpt = text.slice(start, start + max).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
  return (start > 0 ? "…" : "") + excerpt + (start + max < text.length ? "…" : "");
}

async function searchArtifacts(ctx: ReadOnlyContext, query: string, limit = 5) {
  const queryTerms = terms(query);
  if (!queryTerms.length) throw new Error("agent_tool_query_has_no_search_terms");
  const rows = await currentArtifacts(ctx);
  const results: Array<{ artifactId: number; filename: string; score: number; excerpt: string }> = [];
  let bytesRead = 0;
  for (const row of rows) {
    if (bytesRead >= MAX_SEARCH_TOTAL_BYTES) break;
    if (!isTextContentType(row.contentType) || row.size > MAX_ARTIFACT_BYTES) continue;
    try {
      const doc = await readArtifact(ctx, row.id, Math.min(MAX_ARTIFACT_BYTES, MAX_SEARCH_TOTAL_BYTES - bytesRead));
      bytesRead += doc.size;
      const haystack = (doc.filename + "\n" + doc.content).toLowerCase();
      const score = queryTerms.reduce((sum, term) => sum + (haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0), 0);
      if (score > 0) results.push({ artifactId: doc.artifactId, filename: doc.filename, score, excerpt: snippet(doc.content, queryTerms) });
    } catch (error) {
      if (error instanceof Error && error.message === "agent_tool_artifact_size_limit") continue;
      throw error;
    }
  }
  return results.sort((a, b) => b.score - a.score || a.artifactId - b.artifactId).slice(0, limit);
}

function extractiveSummary(content: string, maxSentences: number) {
  const sentences = content.replace(/\s+/g, " ").match(/[^.!?]+[.!?]?/g)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (!sentences.length) return "";
  const frequencies = new Map<string, number>();
  for (const term of terms(content)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  const ranked = sentences.map((sentence, index) => ({ sentence, index, score: terms(sentence).reduce((sum, term) => sum + (frequencies.get(term) ?? 0), 0) / Math.max(1, terms(sentence).length) }));
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, maxSentences).sort((a, b) => a.index - b.index).map(item => item.sentence).join(" ").slice(0, 4000);
}

export async function executeReadOnlyAgentTool(ctx: ReadOnlyContext, tool: string, parameters: unknown): Promise<unknown> {
  switch (tool) {
    case "files.read":
    case "file.read": {
      const input = parse(fileReadSchema, parameters);
      const doc = await readArtifact(ctx, input.artifactId, input.maxBytes ?? MAX_ARTIFACT_BYTES);
      return { artifactId: doc.artifactId, filename: doc.filename, contentType: doc.contentType, size: doc.size, sha256: doc.sha256, content: doc.content };
    }
    case "documents.search": {
      const input = parse(searchSchema, parameters);
      return { query: input.query, results: await searchArtifacts(ctx, input.query, input.limit ?? 5) };
    }
    case "knowledge.retrieve":
    case "knowledge.search": {
      const input = parse(retrieveSchema, parameters);
      return { query: input.query, results: await searchArtifacts(ctx, input.query, input.limit ?? 5) };
    }
    case "documents.summarize":
    case "evidence.summarize": {
      const input = parse(summarizeSchema, parameters);
      const rows = input.artifactId === undefined ? await currentArtifacts(ctx) : (await currentArtifacts(ctx)).filter(row => row.id === input.artifactId);
      if (input.artifactId !== undefined && rows.length === 0) throw new Error("agent_tool_artifact_not_found");
      const summaries = [];
      let remaining = MAX_SEARCH_TOTAL_BYTES;
      for (const row of rows) {
        if (summaries.length >= 10 || remaining <= 0) break;
        const doc = await readArtifact(ctx, row.id, Math.min(MAX_ARTIFACT_BYTES, remaining));
        remaining -= doc.size;
        summaries.push({ artifactId: doc.artifactId, filename: doc.filename, sha256: doc.sha256, summary: extractiveSummary(doc.content, input.maxSentences ?? 5) });
      }
      return { method: "deterministic_extractive", summaries };
    }
    case "task.status": {
      const input = parse(taskStatusSchema, parameters);
      if (input.taskId !== undefined && input.taskId !== ctx.taskId) throw new Error("agent_tool_task_scope_denied");
      const task = await findTaskById(ctx.db, ctx.taskId, ctx.tenantId);
      if (!task) throw new Error("agent_tool_task_not_found");
      return { taskId: task.id, status: task.status, title: task.title, classification: task.classification, createdAt: task.createdAt, updatedAt: task.updatedAt, startedAt: task.startedAt, completedAt: task.completedAt, trajectorySteps: task.trajectorySteps, trajectoryRootHash: task.trajectoryRootHash };
    }
    default: throw new Error("unsupported_read_only_agent_tool");
  }
}
