#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  appendFile, chmod, lstat, mkdir, open as openFile, readFile, realpath, readdir, rename, stat, writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_OPERATIONS = new Set([
  "system_status", "git_status", "git_diff_check", "current_commit", "list_project_root",
  "file_read", "file_change", "typecheck", "lint", "production_closure", "compliance", "crypto_closure", "build",
]);
const VALIDATION_OPERATIONS = new Set(["git_status", "git_diff_check", "current_commit", "typecheck", "lint", "production_closure", "compliance", "crypto_closure", "build"]);
const MAX_FILE_BYTES = 128 * 1024;
const MAX_RESULT_CHARS = 48 * 1024;
const OPERATION_TIMEOUT_MS = {
  git_status: 15000, git_diff_check: 15000, current_commit: 15000,
  typecheck: 180000, lint: 180000, production_closure: 90000, compliance: 90000, crypto_closure: 90000, build: 360000,
};
const HOME = process.env.HOME || "/tmp";
const STATE_ROOT = resolve(HOME, ".local", "state", "gnw-remote-agent");
const AUDIT_FILE = resolve(STATE_ROOT, "audit.jsonl");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalFileChangeDigest(path, content, rationale) {
  return sha256(JSON.stringify(["file_change", path, sha256(content), rationale]));
}
function canonicalOperationDigest(kind, rationale) {
  // Must match the server's exact domain-separated operation/rationale digest.
  return sha256(`GNW-REMOTE-VALIDATION-V1\\0${JSON.stringify([kind, rationale])}`);
}
function safePath(input) {
  if (typeof input !== "string" || input.length < 1 || input.length > 240 || input.includes("\\") || input.startsWith("/") || input.includes("\0")) return null;
  const segments = input.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.startsWith("."))) return null;
  const normalized = segments.join("/");
  const allowed = ["src", "docs", "scripts", "compliance"].some(prefix => normalized.startsWith(prefix + "/")) ||
    ["README.md", "SECURITY.md", "CHANGELOG.md"].includes(normalized);
  const lower = normalized.toLowerCase();
  if (!allowed || /(^|\/)(node_modules|\.git|\.ssh|credentials?|secrets?)(\/|$)/.test(lower) ||
      /(^|\/)\.env($|\.)/.test(lower) || /\.(pem|key|p12|pfx|crt|cer|db|sqlite)$/i.test(lower) ||
      /package(-lock)?\.json$/i.test(lower) || /secret|credential|private.?key|token/i.test(lower)) return null;
  return normalized;
}
function withinRoot(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}
function redacted(text) {
  return String(text || "")
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]{24,}/gi, "$1[REDACTED]")
    .slice(0, MAX_RESULT_CHARS);
}
async function audit(event) {
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  await chmod(STATE_ROOT, 0o700);
  await appendFile(AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { encoding: "utf8", mode: 0o600 });
  await chmod(AUDIT_FILE, 0o600);
}
async function workspaceRoot() {
  const configured = process.env.GNW_WORKSPACE;
  if (!configured || !isAbsolute(configured)) throw new Error("GNW_WORKSPACE must be an absolute directory path.");
  const root = await realpath(configured);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("GNW_WORKSPACE is not a directory.");
  const gitPath = resolve(root, ".git");
  const packagePath = resolve(root, "package.json");
  const [gitStat, packageStat] = await Promise.all([lstat(gitPath), lstat(packagePath)]);
  if (!(gitStat.isDirectory() || gitStat.isFile()) || !packageStat.isFile()) throw new Error("GNW_WORKSPACE must be the GNW Git repository root.");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (manifest.name !== "gnw-governed-agent-v4") throw new Error("Workspace package identity did not match GNW.");
  return root;
}
function commandEnvironment() {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: HOME,
    TMPDIR: process.env.TMPDIR || "/tmp",
    CI: "1",
    NO_COLOR: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
    LC_ALL: "C.UTF-8",
  };
}
async function runFixedCommand(root, executable, args, timeoutMs) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(executable, args, {
      cwd: root,
      env: commandEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (target, chunk) => {
      const remaining = MAX_RESULT_CHARS - target.length;
      if (remaining > 0) return target + chunk.toString("utf8").slice(0, remaining);
      return target;
    };
    child.stdout.on("data", chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = collect(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref();
    }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timer);
      resolvePromise({ ok: false, stdout: redacted(stdout), stderr: redacted(stderr + "\n" + error.message), exitCode: null, durationMs: Date.now() - started, timedOut });
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolvePromise({ ok: code === 0 && !timedOut, stdout: redacted(stdout), stderr: redacted(stderr), exitCode: typeof code === "number" ? code : null, durationMs: Date.now() - started, timedOut });
    });
  });
}
async function verifySafeParent(root, relativePath) {
  const safe = safePath(relativePath);
  if (!safe) throw new Error("Project path is outside the remote-agent allowlist.");
  const target = resolve(root, safe);
  if (!withinRoot(root, target)) throw new Error("Project path escapes the workspace.");
  const parent = await realpath(dirname(target));
  if (!withinRoot(root, parent)) throw new Error("Project path parent escapes the workspace.");
  return { safe, target, parent };
}
async function readProjectFile(root, relativePath) {
  const { safe, target, parent } = await verifySafeParent(root, relativePath);
  if (parent !== await realpath(dirname(target))) throw new Error("Project path changed during validation.");
  // Open without following a final symlink, then verify the pinned descriptor resolves
  // inside the workspace before reading. This closes the lstat/readFile pathname race.
  const handle = await openFile(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const targetStat = await handle.stat();
    if (!targetStat.isFile() || targetStat.size > MAX_FILE_BYTES) throw new Error("Project file is not a bounded regular text file.");
    const descriptorPath = await realpath(`/proc/self/fd/${handle.fd}`);
    if (!withinRoot(root, descriptorPath)) throw new Error("Opened project file resolves outside the workspace.");
    const bytes = await handle.readFile();
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { path: safe, content, size: bytes.byteLength, sha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}
async function writeApprovedFileChange(root, task) {
  const args = task.arguments;
  const path = safePath(args?.path);
  const content = typeof args?.content === "string" ? args.content : null;
  const rationale = typeof args?.rationale === "string" ? args.rationale.trim() : "";
  if (!path || content === null || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES || !rationale || rationale.length > 1000) throw new Error("Approved file-change payload is invalid.");
  if (args.contentSha256 !== sha256(content) || !task.actionDigest || task.actionDigest !== canonicalFileChangeDigest(path, content, rationale)) throw new Error("Approved file-change digest mismatch.");
  const { target, parent } = await verifySafeParent(root, path);
  let originalBytes = null;
  let originalMode = 0o600;
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw new Error("Target is not an allowed regular file.");
    originalBytes = await readFile(target);
    originalMode = metadata.mode & 0o777;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      originalBytes = null;
    } else throw error;
  }
  const backupDirectory = resolve(STATE_ROOT, "backups");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700);
  const backupId = task.id.replace(/[^0-9a-f-]/gi, "");
  const backupPath = resolve(backupDirectory, backupId + ".bak");
  const metadataPath = resolve(backupDirectory, backupId + ".json");
  const backupMetadata = {
    taskId: task.id, path, existed: originalBytes !== null,
    previousSha256: originalBytes ? sha256(originalBytes) : null,
    proposedSha256: sha256(content), actionDigest: task.actionDigest,
    createdAt: new Date().toISOString(),
  };
  if (originalBytes !== null) await writeFile(backupPath, originalBytes, { flag: "wx", mode: 0o600 });
  await writeFile(metadataPath, JSON.stringify(backupMetadata, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const currentParent = await realpath(dirname(target));
  if (currentParent !== parent || !withinRoot(root, currentParent)) throw new Error("Target parent changed during file-change validation.");
  if (originalBytes !== null) {
    const latest = await lstat(target);
    if (latest.isSymbolicLink() || !latest.isFile() || sha256(await readFile(target)) !== sha256(originalBytes)) throw new Error("Target changed while creating the approval-bound backup.");
  } else {
    try { await lstat(target); throw new Error("A new file appeared after approval."); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const tempPath = resolve(parent, ".gnw-write-" + backupId);
  await writeFile(tempPath, content, { flag: "wx", mode: originalMode });
  try {
    await rename(tempPath, target);
  } catch (error) {
    try { const { unlink } = await import("node:fs/promises"); await unlink(tempPath); } catch {}
    throw error;
  }
  const written = await readFile(target);
  if (sha256(written) !== sha256(content)) throw new Error("Post-write digest check failed; backup was retained.");
  await audit({ event: "approved_file_change_applied", taskId: task.id, path, contentSha256: sha256(content), actionDigest: task.actionDigest, backupId, previousFileExisted: originalBytes !== null });
  return { path, contentSha256: sha256(content), backupId, previousFileExisted: originalBytes !== null, bytes: written.byteLength };
}
async function executeTask(root, task) {
  if (!task || typeof task !== "object" || !ALLOWED_OPERATIONS.has(task.kind)) throw new Error("Remote task kind is not allowlisted.");
  if (task.kind === "system_status") {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    return { ok: true, result: { platform: process.platform, arch: process.arch, nodeVersion: process.version, workspace: basename(root), package: packageJson.name, packageVersion: packageJson.version }, durationMs: 0 };
  }
  if (task.kind === "list_project_root") {
    const names = await readdir(root, { withFileTypes: true });
    const entries = names.filter(entry => !entry.name.startsWith(".") && !["node_modules", "dist", "coverage", "data"].includes(entry.name))
      .map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
    return { ok: true, result: { entries, count: entries.length }, durationMs: 0 };
  }
  if (task.kind === "file_read") {
    const result = await readProjectFile(root, task.arguments?.path);
    await audit({ event: "approved_scope_file_read", taskId: task.id, path: result.path, sha256: result.sha256, bytes: result.size });
    return { ok: true, result, durationMs: 0 };
  }
  if (task.kind === "file_change") {
    return { ok: true, result: await writeApprovedFileChange(root, task) , durationMs: 0 };
  }
  if (VALIDATION_OPERATIONS.has(task.kind)) {
    const rationale = typeof task.arguments?.rationale === "string" ? task.arguments.rationale.trim() : "";
    if (!rationale || task.actionDigest !== canonicalOperationDigest(task.kind, rationale)) throw new Error("Approved validation action digest mismatch.");
  }
  const commandMap = {
    git_status: ["git", ["status", "--short", "--branch"]],
    git_diff_check: ["git", ["diff", "--check"]],
    current_commit: ["git", ["rev-parse", "HEAD"]],
    typecheck: ["npm", ["run", "typecheck"]],
    lint: ["npm", ["run", "lint"]],
    production_closure: ["npm", ["run", "verify:production"]],
    compliance: ["npm", ["run", "verify:compliance"]],
    crypto_closure: ["npm", ["run", "verify:crypto"]],
    build: ["npm", ["run", "build"]],
  };
  const operation = commandMap[task.kind];
  if (!operation) throw new Error("No fixed command is registered for this operation.");
  const result = await runFixedCommand(root, operation[0], operation[1], OPERATION_TIMEOUT_MS[task.kind] || 60000);
  await audit({
    event: "fixed_operation_completed", taskId: task.id, kind: task.kind,
    actionDigest: task.actionDigest || null, ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs,
  });
  return result;
}
async function postJson(baseUrl, token, path, data, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "authorization": "Bearer " + token, "content-type": "application/json", "accept": "application/json" },
      body: data === undefined ? "{}" : JSON.stringify(data),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (bodyText.length > 1024 * 1024) throw new Error("gateway_response_too_large");
    let parsed = {};
    try { parsed = bodyText ? JSON.parse(bodyText) : {}; } catch { throw new Error("gateway_returned_invalid_json"); }
    if (!response.ok) throw new Error("gateway_http_" + response.status + ":" + String(parsed.error || "request_failed").slice(0, 120));
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
function gatewayUrl() {
  const raw = process.env.GNW_GATEWAY_URL;
  if (!raw || raw.length > 2048) throw new Error("GNW_GATEWAY_URL is required.");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("GNW_GATEWAY_URL must be an origin without path or credentials.");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw new Error("GNW_GATEWAY_URL must use HTTPS.");
  return url.origin;
}
async function main() {
  const token = process.env.GNW_AGENT_TOKEN || "";
  if (!token.startsWith("gnw_agent_") || token.length < 40 || token.length > 160) throw new Error("GNW_AGENT_TOKEN is missing or malformed.");
  const baseUrl = gatewayUrl();
  const root = await workspaceRoot();
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  await chmod(STATE_ROOT, 0o700);
  await audit({ event: "agent_started", workspace: basename(root), gatewayOrigin: new URL(baseUrl).origin });
  let delayMs = 2500;
  let consecutiveFailures = 0;
  let lastHeartbeat = 0;
  console.log("GNW remote agent started for workspace " + basename(root) + ". Token is never printed.");
  while (true) {
    try {
      const now = Date.now();
      if (now - lastHeartbeat > 30000) {
        await postJson(baseUrl, token, "/mcp-agent/heartbeat", {});
        lastHeartbeat = now;
      }
      const next = await postJson(baseUrl, token, "/mcp-agent/next", {});
      const task = next.task;
      if (!task) {
        consecutiveFailures = 0;
        delayMs = 2500;
        await new Promise(resolvePromise => setTimeout(resolvePromise, delayMs));
        continue;
      }
      let output;
      let status = "completed";
      let errorSummary = "";
      const started = Date.now();
      try {
        output = await executeTask(root, task);
        if (!output || output.ok !== true) {
          status = "failed";
          errorSummary = "Fixed GNW operation returned a non-zero status or timeout.";
        }
      } catch (error) {
        status = "failed";
        errorSummary = String(error instanceof Error ? error.message : "remote_operation_failed").slice(0, 900);
        output = { ok: false, stdout: "", stderr: errorSummary, exitCode: null, durationMs: Date.now() - started };
        await audit({ event: "operation_failed", taskId: task.id, kind: task.kind, reason: errorSummary });
      }
      const outputJson = JSON.stringify(output);
      if (Buffer.byteLength(outputJson, "utf8") > 900 * 1024) {
        output = { ok: false, stdout: "", stderr: "Agent result exceeded the configured size limit.", exitCode: null, durationMs: Date.now() - started };
        status = "failed";
        errorSummary = "Agent result exceeded the configured size limit.";
      }
      await postJson(baseUrl, token, "/mcp-agent/result", {
        taskId: task.id, status, output, errorSummary,
      }, 30000);
      consecutiveFailures = 0;
      delayMs = 2500;
    } catch (error) {
      consecutiveFailures += 1;
      const message = String(error instanceof Error ? error.message : "remote_agent_error").slice(0, 240);
      await audit({ event: "gateway_or_poll_error", error: message, consecutiveFailures }).catch(() => {});
      delayMs = Math.min(60000, Math.max(2500, delayMs * 2));
      const jitter = Math.floor(Math.random() * Math.min(1500, delayMs / 3));
      await new Promise(resolvePromise => setTimeout(resolvePromise, delayMs + jitter));
      if (consecutiveFailures % 20 === 0) console.error("GNW remote agent reconnects are failing; last error: " + message);
    }
  }
}
main().catch(error => {
  console.error("GNW remote agent could not start: " + String(error instanceof Error ? error.message : "configuration error"));
  process.exitCode = 1;
});
