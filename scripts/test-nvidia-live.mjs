#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const envContent = await readFile(resolve(process.cwd(), '.env'), 'utf8');
  const env = Object.fromEntries(
    envContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
  );

  const apiKey = env.LLM_API_KEY;
  const baseUrl = env.LLM_BASE_URL || 'https://integrate.api.nvidia.com/v1';

  if (!apiKey) {
    console.error('LLM_API_KEY missing from .env');
    process.exit(1);
  }

  console.log(`NVIDIA NIM Live Test Initializing...`);
  console.log(`Endpoint: ${baseUrl}/chat/completions`);
  console.log(`API Key: [CONFIGURED IN ENVIRONMENT]`);

  async function testModel(modelId, prompt, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: 'You are a concise AI system health validator.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 32,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      const latency = Date.now() - start;
      if (!response.ok) {
        const errorText = await response.text();
        return {
          model: modelId,
          status: 'FAIL',
          httpStatus: response.status,
          latencyMs: latency,
          error: errorText.slice(0, 120),
        };
      }

      const json = await response.json();
      const answer = json.choices?.[0]?.message?.content?.trim() || '';
      return {
        model: modelId,
        status: 'PASS',
        httpStatus: response.status,
        latencyMs: latency,
        response: answer,
        usage: json.usage,
      };
    } catch (err) {
      return {
        model: modelId,
        status: 'TIMEOUT/ERROR',
        latencyMs: Date.now() - start,
        error: err.name === 'AbortError' ? 'Request timed out (20s)' : (err instanceof Error ? err.message : String(err)),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const modelsToTest = [
    { label: 'Primary (Nemotron 3 Ultra 550B)', id: 'nvidia/nemotron-3-ultra-550b-a55b' },
    { label: 'Alternative Nemotron (Llama 3.1 70B)', id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
    { label: 'Vision / General (Llama 3.2 11B)', id: 'meta/llama-3.2-11b-vision-instruct' },
    { label: 'DeepSeek Coding (6.7B)', id: 'deepseek-ai/deepseek-coder-6.7b-instruct' },
  ];

  for (const m of modelsToTest) {
    console.log(`\nTesting ${m.label} [${m.id}]...`);
    const result = await testModel(m.id, 'Ping. Reply "PONG".');
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(console.error);
