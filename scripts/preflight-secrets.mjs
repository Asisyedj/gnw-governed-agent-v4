#!/usr/bin/env node
// scripts/preflight-secrets.mjs
// Fail-closed preflight validation for GNW secret manifest.
// Usage: node scripts/preflight-secrets.mjs [--manifest path] [--env-path path]
//
// Exit 0 = PASS (all required secrets fetched)
// Exit 1 = FAIL (missing required secrets or provider error)

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Minimal inline env-file reader (avoids importing TS at runtime)
// ---------------------------------------------------------------------------

async function parseEnvFile(envPath) {
  const env = {};
  try {
    const raw = await readFile(resolve(envPath), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch (err) {
    console.error(`[PREFLIGHT] Failed to read env file: ${envPath}`, err.message);
    return null;
  }
  return env;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function arg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const manifestPath = arg("--manifest", resolve(ROOT, "secret-manifest.staging.json"));
const envPath = arg("--env-path", resolve(ROOT, ".env"));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[PREFLIGHT] GNW Secret Preflight Validator");
  console.log("[PREFLIGHT] Manifest:", manifestPath);
  console.log("[PREFLIGHT] Env file:", envPath);
  console.log();

  // 1. Load manifest
  let manifest;
  try {
    const raw = await readFile(manifestPath, "utf-8");
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error("[PREFLIGHT] FAIL — cannot load manifest:", err.message);
    process.exit(1);
  }

  if (manifest.schema !== "GNW.SecretManifest.v1") {
    console.error("[PREFLIGHT] FAIL — invalid manifest schema:", manifest.schema);
    process.exit(1);
  }

  // 2. Load env files (supports comma-separated paths, e.g. .env,.env.staging)
  const envPaths = envPath.split(",").map(p => p.trim()).filter(Boolean);
  const env = {};
  for (const p of envPaths) {
    const parsed = await parseEnvFile(p);
    if (parsed) {
      Object.assign(env, parsed);
    }
  }
  if (Object.keys(env).length === 0) {
    console.error("[PREFLIGHT] FAIL — cannot read any env file from: " + envPath);
    process.exit(1);
  }

  const secretCount = Object.keys(manifest.secrets).length;
  console.log(`[PREFLIGHT] Provider: ${manifest.provider}`);
  console.log(`[PREFLIGHT] Secrets in manifest: ${secretCount}`);
  console.log();

  // 3. Check each secret
  const fetched = [];
  const failed = [];
  const optional_missing = [];

  for (const [envVar, entry] of Object.entries(manifest.secrets)) {
    const value = env[envVar];
    const present = value !== undefined && value !== "";

    if (present) {
      fetched.push(envVar);
    } else if (entry.required) {
      failed.push(envVar);
    } else {
      optional_missing.push(envVar);
    }
  }

  // 4. Report
  console.log("--- Required secrets ---");
  for (const name of fetched) {
    const cat = manifest.secrets[name]?.category ?? "";
    console.log(`  ✓ ${name} [${cat}]`);
  }
  if (failed.length > 0) {
    console.log();
    console.log("--- MISSING required secrets ---");
    for (const name of failed) {
      const cat = manifest.secrets[name]?.category ?? "";
      console.log(`  ✗ ${name} [${cat}]`);
    }
  }
  if (optional_missing.length > 0) {
    console.log();
    console.log("--- Optional (not set) ---");
    for (const name of optional_missing) {
      const cat = manifest.secrets[name]?.category ?? "";
      console.log(`  ○ ${name} [${cat}]`);
    }
  }

  console.log();
  const status = failed.length === 0 ? "PASS" : "FAIL";
  const result = {
    schema: "GNW.PreflightSecrets.v1",
    provider: manifest.provider,
    timestamp: new Date().toISOString(),
    secretCount,
    fetchedCount: fetched.length,
    optionalMissing: optional_missing.length,
    failedSecrets: failed,
    status,
  };

  console.log(JSON.stringify(result, null, 2));
  console.log();
  console.log(`[PREFLIGHT] Secret preflight ${status} (${fetched.length}/${secretCount} fetched, ${failed.length} required missing)`);

  process.exit(status === "PASS" ? 0 : 1);
}

main().catch(err => {
  console.error("[PREFLIGHT] Unexpected error:", err);
  process.exit(1);
});
