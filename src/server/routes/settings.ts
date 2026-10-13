import type { FastifyPluginAsync } from "fastify";
import { findSessionByTokenHash } from "../repo.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // Session authentication hook
  app.addHook("preHandler", async (req, reply) => {
    const raw = req.cookies.session;
    if (!raw) return reply.status(401).send({ error: "Authentication required", code: "unauthenticated" });
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const session = await findSessionByTokenHash(app.db, tokenHash);
    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({ error: "Session invalid or expired", code: "session_expired" });
    }
  });

  // GET /api/settings
  app.get("", async (_req, reply) => {
    const apiKey = process.env.LLM_API_KEY ?? "";
    const maskedKey = apiKey ? "configured" : "none";
    return reply.send({
      provider: "NVIDIA NIM",
      baseUrl: process.env.LLM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
      model: process.env.LLM_MODEL ?? "meta/llama-3.2-11b-vision-instruct",
      deepResearchModel: process.env.GNW_DEEP_RESEARCH_MODEL ?? "meta/llama-3.2-11b-vision-instruct",
      apiKeyConfigured: Boolean(apiKey),
      maskedApiKey: maskedKey,
      availableModels: [
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
        "ai21labs/jamba-1.5-large-instruct"
      ]
    });
  });

  // POST /api/settings/test
  app.post("/test", async (req, reply) => {
    const apiKey = process.env.LLM_API_KEY;
    const baseUrl = process.env.LLM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
    const body = req.body as { model?: string; prompt?: string } | undefined;
    const model = body?.model ?? process.env.LLM_MODEL ?? "meta/llama-3.2-11b-vision-instruct";
    const prompt = body?.prompt ?? "Provide a 1-sentence confirmation that the NVIDIA NIM API connection is active and functioning for GNW.";

    if (!apiKey) {
      return reply.status(400).send({ ok: false, error: "NVIDIA API Key not configured" });
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
            { role: "user", content: prompt }
          ],
          max_tokens: 150,
          temperature: 0.2
        })
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const errorText = await res.text();
        return reply.status(502).send({ ok: false, status: res.status, error: errorText, latencyMs });
      }

      const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage?: unknown; model: string };
      return reply.send({
        ok: true,
        model: data.model ?? model,
        response: data.choices?.[0]?.message?.content ?? "",
        usage: data.usage,
        latencyMs
      });
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err instanceof Error ? err.message : "Inference error" });
    }
  });

  // PUT /api/settings
  app.put("", async (req, reply) => {
    const body = req.body as { model?: string; apiKey?: string };
    let envContent = "";
    try {
      envContent = readFileSync(".env", "utf8");
    } catch {
      envContent = "";
    }

    if (body.model) {
      process.env.LLM_MODEL = body.model;
      process.env.GNW_DEEP_RESEARCH_MODEL = body.model;
      envContent = envContent.replace(/LLM_MODEL=.*/g, `LLM_MODEL=${body.model}`);
      envContent = envContent.replace(/GNW_DEEP_RESEARCH_MODEL=.*/g, `GNW_DEEP_RESEARCH_MODEL=${body.model}`);
    }

    if (body.apiKey) {
      process.env.LLM_API_KEY = body.apiKey;
      process.env.GNW_DEEP_RESEARCH_API_KEY = body.apiKey;
      envContent = envContent.replace(/LLM_API_KEY=.*/g, `LLM_API_KEY=${body.apiKey}`);
      envContent = envContent.replace(/GNW_DEEP_RESEARCH_API_KEY=.*/g, `GNW_DEEP_RESEARCH_API_KEY=${body.apiKey}`);
    }

    try {
      writeFileSync(".env", envContent, "utf8");
    } catch {
      // best-effort
    }

    return reply.send({ ok: true, message: "NVIDIA API settings updated successfully" });
  });
};
