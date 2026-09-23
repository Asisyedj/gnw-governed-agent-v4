import type { Env } from "./env.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LlmOptions = { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number };
export type LlmResult = { content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } };

export class LlmClient {
  constructor(private readonly env: Env) {}

  async chat(messages: ChatMessage[], opts: LlmOptions = {}): Promise<LlmResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.env.llmTimeoutMs);
    try {
      const resp = await fetch(`${this.env.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.env.llmApiKey}` },
        body: JSON.stringify({
          model: opts.model ?? this.env.llmModel,
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`LLM API error: ${resp.status} ${resp.statusText}`);
      const json = await resp.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
      const content = json.choices[0]?.message?.content ?? "";
      const usage = json.usage ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens } : undefined;
      return { content, usage };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLlmClient(env: Env): LlmClient { return new LlmClient(env); }
