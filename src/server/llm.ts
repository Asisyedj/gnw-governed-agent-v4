import type { Env } from "./env.js";
import { assertEgressUrl, governedFetch } from "./security.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LlmOptions = { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number };
export type LlmResult = { content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } };

const MAX_LLM_RESPONSE_BYTES = 4 * 1024 * 1024;

export class LlmClient {
  constructor(private readonly env: Env) {}

  async chat(messages: ChatMessage[], opts: LlmOptions = {}): Promise<LlmResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.env.llmTimeoutMs);
    try {
      const endpoint = new URL(this.env.llmBaseUrl + "/chat/completions");
      if (this.env.isProduction) {
        if (!this.env.llmApiKey) throw new Error("llm_api_key_missing");
        if (!this.env.egressAllowList.length) throw new Error("llm_egress_allowlist_missing");
        assertEgressUrl(endpoint.toString(), this.env.egressAllowList);
      }

      const body = JSON.stringify({
        model: opts.model ?? this.env.llmModel,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
      });

      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.env.llmApiKey}`,
        },
        body,
        redirect: "manual",
        signal: controller.signal,
      };

      const resp = this.env.isProduction
        ? await governedFetch(endpoint.toString(), requestInit, MAX_LLM_RESPONSE_BYTES)
        : await fetch(endpoint, requestInit);

      if (!resp.ok) throw new Error(`LLM API error: ${resp.status} ${resp.statusText}`);
      const json = await resp.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = json.choices[0]?.message?.content ?? "";
      const usage = json.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens }
        : undefined;
      return usage ? { content, usage } : { content };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLlmClient(env: Env): LlmClient { return new LlmClient(env); }
