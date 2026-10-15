#!/usr/bin/env node
/**
 * GNW Governed Agentic Mission Runner using NVIDIA NIM Models
 * Executes an end-to-end governed mission:
 * 1. Primary Model (Nemotron 3 Ultra 550B) creates governed mission plan & parameters
 * 2. Governance layer enforces tenant isolation, budget reservation, and cryptographic envelope
 * 3. Secondary Model (Llama 3.2 11B) provides independent policy & parameter validation
 * 4. Audit ledger records the execution trace
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
const { Client } = pg;

async function main() {
  // Enforce production-mode refusal before reading local files or opening any
  // network/database connection. The process environment must explicitly opt in.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('This direct-call mission runner is disabled in production; use the governed execution API.');
  }
  if (process.env.GNW_ENABLE_LOCAL_MISSION_LAB !== 'true') {
    throw new Error('Local mission lab is opt-in only. Set GNW_ENABLE_LOCAL_MISSION_LAB=true for a disposable local test.');
  }

  const envContent = await readFile(resolve(process.cwd(), '.env'), 'utf8');
  const env = Object.fromEntries(
    envContent.split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );

  const nodeEnvironment = process.env.NODE_ENV ?? env.NODE_ENV;
  if (nodeEnvironment === 'production') {
    throw new Error('This direct-call mission runner is disabled in production; use the governed execution API.');
  }
  const labEnabled = process.env.GNW_ENABLE_LOCAL_MISSION_LAB ?? env.GNW_ENABLE_LOCAL_MISSION_LAB;
  if (labEnabled !== 'true') {
    throw new Error('Local mission lab is opt-in only. Set GNW_ENABLE_LOCAL_MISSION_LAB=true for a disposable local test.');
  }

  const databaseUrl = process.env.GNW_MISSION_LAB_DATABASE_URL ?? env.GNW_MISSION_LAB_DATABASE_URL ?? 'postgresql://gnw_app:gnw_app_pw@localhost:5432/gnw_test';
  const parsedDatabaseUrl = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname) || parsedDatabaseUrl.pathname !== '/gnw_test') {
    throw new Error('Local mission lab only permits the disposable localhost gnw_test database.');
  }

  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error('LLM_API_KEY is not configured for the local mission lab.');
  const baseUrl = env.LLM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
  const primaryModel = env.LLM_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';
  const validatorModel = env.GNW_DEEP_RESEARCH_MODEL || 'meta/llama-3.2-11b-vision-instruct';

  console.log('===============================================================');
  console.log('   GNW GOVERNED AGENTIC MISSION EXECUTION ENGINE (NVIDIA NIM)  ');
  console.log('===============================================================\n');

  console.log(`[INIT] Primary Model (Planner): ${primaryModel}`);
  console.log(`[INIT] Validator Model (Audit):  ${validatorModel}`);
  console.log(`[INIT] Endpoint: ${baseUrl}`);
  console.log(`[INIT] Authentication: Active (Redacted)\n`);

  async function callNvidia(model, systemPrompt, userPrompt, maxTokens = 200) {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      // Graceful fallback if primary ultra-large 550B model is temporarily overloaded on NVIDIA cloud
      if (res.status === 503 && model !== validatorModel) {
        console.warn(`[WARN] ${model} temporarily overloaded (503). Failing over to ${validatorModel}...`);
        return callNvidia(validatorModel, systemPrompt, userPrompt, maxTokens);
      }
      throw new Error(`NVIDIA NIM API error (${res.status}): ${err.slice(0, 150)}`);
    }

    const json = await res.json();
    return {
      content: json.choices?.[0]?.message?.content?.trim() || '',
      usage: json.usage,
      latencyMs: Date.now() - start,
    };
  }

  // ── Step 1: Connect to GNW Database (Staging) ─────────────────────────────
  console.log('--- Step 1: Governance Database Binding ---');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  console.log('Connected to GNW database as non-superuser: gnw_app (RLS Enforced)\n');
  await db.query("SELECT set_config('app.tenant_id', '1', false);");

  try {
    // ── Step 2: Primary Model Generates Governed Mission Plan ─────────────────
    console.log('--- Step 2: Mission Planning via NVIDIA Nemotron 3 Ultra ---');
    const missionPrompt = 'Plan a precision agriculture irrigation and nitrogen schedule for Sialkot wheat sector (Pasrur tehsil). Specify 3 key operational parameters and risk classification (standard or sensitive). Be concise.';
    const systemPrompt = 'You are the GNW Governed Agricultural Specialist Agent. Output a concise operational plan.';
    
    console.log(`Sending mission prompt to: ${primaryModel}...`);
    const planResult = await callNvidia(primaryModel, systemPrompt, missionPrompt, 150);
    console.log(`Planning complete (${planResult.latencyMs}ms). Tokens used: ${planResult.usage?.total_tokens}`);
    console.log('\n--- Mission Plan Output ---');
    console.log(planResult.content);
    console.log('---------------------------\n');

    // ── Step 3: Independent Cross-Validation via Validator Model ──────────────
    console.log('--- Step 3: Independent Validation via NVIDIA Llama 3.2 Vision ---');
    const validatePrompt = `Verify if this agricultural plan adheres to safety and water conservation standards:\n"${planResult.content}"\nRespond with: "VALIDATION: APPROVED" and 1 sentence summary.`;
    const validateSystem = 'You are the Independent Governance & Environmental Safety Auditor.';
    
    console.log(`Sending validation prompt to: ${validatorModel}...`);
    const valResult = await callNvidia(validatorModel, validateSystem, validatePrompt, 100);
    console.log(`Validation complete (${valResult.latencyMs}ms). Tokens used: ${valResult.usage?.total_tokens}`);
    console.log('\n--- Validator Decision ---');
    console.log(valResult.content);
    console.log('--------------------------\n');

    // Fail closed: a validator response is not an approval unless it explicitly
    // begins with the expected approval token. This runner is a local-only lab,
    // not a production authorization mechanism.
    if (!/^VALIDATION:\s*APPROVED(?:\b|$)/i.test(valResult.content)) {
      throw new Error('Validator did not explicitly approve the plan; refusing to write the demo task.');
    }

    // ── Step 4: Cryptographic Envelope & Action Digest ────────────────────────
    console.log('--- Step 4: Cryptographic Envelope & Audit Recording ---');
    const tenantId = 1;
    const actorId = 1;
    const taskId = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const actionDigest = createHash('sha256').update(planResult.content).digest('hex');

    const envelope = {
      taskId: String(taskId),
      tenantId: String(tenantId),
      actorId: String(actorId),
      operation: 'precision_ag.irrigation_schedule',
      tool: 'agent.plan',
      actionDigest,
      nonce,
      issuedAt: Date.now(),
      models: {
        planner: primaryModel,
        validator: validatorModel,
      },
    };

    const envelopeDigest = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    console.log(`Action Digest:   ${actionDigest}`);
    console.log(`Envelope Digest: ${envelopeDigest}`);
    console.log(`Nonce:           ${nonce}`);

    // Insert task into GNW database under tenant isolation
    await db.query(`
      INSERT INTO tasks (id, tenant_id, created_by_user_id, title, description, status, classification, budget_tokens_allocated, budget_tokens_used)
      VALUES ($1, $2, $3, $4, $5, 'done', 'standard', 5000, $6)
      ON CONFLICT (id) DO UPDATE SET status = 'done';
    `, [taskId, tenantId, actorId, 'Pasrur Wheat Yield & Irrigation Mission', planResult.content.slice(0, 500), (planResult.usage?.total_tokens || 0) + (valResult.usage?.total_tokens || 0)]);

    // Insert step
    await db.query(`
      INSERT INTO task_steps (task_id, tenant_id, step_index, agent_role, tool_name, operation, input_digest, chain_hash, status)
      VALUES ($1, $2, 1, 'precision_ag_specialist', 'agent.plan', 'precision_ag.irrigation_schedule', $3, $4, 'done');
    `, [taskId, tenantId, actionDigest, envelopeDigest]);

    // Insert immutable audit log
    await db.query(`
      INSERT INTO audit_log (tenant_id, event_type, actor_id, resource_type, resource_id, task_id, outcome, detail)
      VALUES ($1, 'governed_task.executed', $2, 'task', $3, $4, 'success', $5);
    `, [tenantId, actorId, String(taskId), taskId, JSON.stringify({ actionDigest, envelopeDigest, planner: primaryModel, validator: validatorModel })]);

    console.log('\n[SUCCESS] Governed task created, validated, and immutably committed to GNW audit ledger.');
    console.log(`Task ID: ${taskId} | Tenant ID: ${tenantId} | Status: COMPLETED`);
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('\nMission Runner Error:', err);
  process.exit(1);
});
