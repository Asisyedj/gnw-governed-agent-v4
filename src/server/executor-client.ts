import { createHmac } from "node:crypto";
import type { Env } from "./env.ts";

export type ExecutorResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function callExecutor(
  env: Env,
  command: string[],
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<ExecutorResult> {
  if (!env.executorUrl) throw new Error("GNW_EXECUTOR_URL not configured");
  const token = createHmac("sha256", env.executorSharedToken).update("gnw-executor-v1").digest("hex");
  const res = await fetch(`${env.executorUrl}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ command, cwd: opts?.cwd, timeoutMs: opts?.timeoutMs ?? 30_000 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Executor HTTP ${res.status}`);
  return res.json() as Promise<ExecutorResult>;
}
