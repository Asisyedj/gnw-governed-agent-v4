import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { findSessionByTokenHash } from "../repo.js";
import { createHash } from "node:crypto";

const DEFAULT_MODEL = "meta/llama-3.2-11b-vision-instruct";
const AVAILABLE_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "meta/llama-4-maverick-17b-128e-instruct",
  "meta/llama-4-scout-17b-16e-instruct",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "meta/llama-3.2-11b-vision-instruct",
  "deepseek-ai/deepseek-v4.1-flash",
  "deepseek-ai/deepseek-coder-6.7b-instruct",
  "mistralai/mistral-large-2-instruct",
  "mistralai/mistral-7b-instruct-v0.3",
  "google/gemma-3-27b-it",
  "ibm/granite-3.0-8b-instruct",
  "ai21labs/jamba-1.5-large-instruct",
] as const;

const settingsTestSchema = z.object({
  model: z.enum(AVAILABLE_MODELS).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
}).strict();

function configuredModel(): string {
  const candidate = process.env.LLM_MODEL;
  return candidate && (AVAILABLE_MODELS as readonly string[]).includes(candidate)
    ? candidate
    : DEFAULT_MODEL;
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // This route authenticates reads and tests. It never writes credentials to
  // process.env or .env; secrets must be provisioned through the deployment
  // secret provider, outside the application request path.
  app.addHook("preHandler", async (req, reply) => {
    const raw = req.cookies.session;
    if (!raw) return reply.status(401).send({ error: "Authentication required", code: "unauthenticated" });
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const session = await findSessionByTokenHash(app.db, tokenHash);
    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({ error: "Session invalid or expired", code: "session_expired" });
    }
  });

  app.get("", async (_req, reply) => {
    const apiKey = process.env.LLM_API_KEY ?? "";
    const activeModel = configuredModel();
    return reply.send({
      provider: "NVIDIA NIM",
      baseUrl: process.env.LLM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
      model: activeModel,
      deepResearchModel: process.env.GNW_DEEP_RESEARCH_MODEL ?? activeModel,
      apiKeyConfigured: Boolean(apiKey),
      maskedApiKey: apiKey ? "configured" : "none",
      availableModels: AVAILABLE_MODELS,
      settingsManagedExternally: true,
    });
  });

  app.post("/test", async (req, reply) => {
    const parsed = settingsTestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "Invalid model or prompt", code: "invalid_input" });
    }

    const apiKey = process.env.LLM_API_KEY;
    const baseUrl = process.env.LLM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
    const model = parsed.data.model ?? configuredModel();
    const prompt = parsed.data.prompt ?? "Provide a 1-sentence confirmation that the NVIDIA NIM API connection is active and functioning for GNW.";

    if (!apiKey) {
      return reply.status(400).send({ ok: false, error: "NVIDIA API key must be provisioned by the deployment secret provider", code: "provider_secret_missing" });
    }

    try {
      const start = Date.now();
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are the GNW Precision Agriculture AI for Sialkot district." },
            { role: "user", content: prompt },
          ],
          max_tokens: 150,
          temperature: 0.2,
        }),
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        // Do not echo provider response bodies: upstream errors may include
        // operational details that should not be exposed to browser clients.
        return reply.status(502).send({ ok: false, status: res.status, error: "NVIDIA inference request failed", latencyMs });
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown; model?: string };
      return reply.send({
        ok: true,
        model: data.model ?? model,
        response: data.choices?.[0]?.message?.content ?? "",
        usage: data.usage,
        latencyMs,
      });
    } catch {
      return reply.status(502).send({ ok: false, error: "NVIDIA inference request failed" });
    }
  });

  // Compatibility route: reject all runtime writes. Editing .env from an HTTP
  // request is unsafe and unreliable across replicas; use an approved external
  // secret/configuration workflow instead.
  app.put("", async (_req, reply) => {
    return reply.status(403).send({
      ok: false,
      error: "AI model and API credentials are managed by deployment configuration and the secret provider.",
      code: "settings_managed_externally",
    });
  });
};
