#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const child = spawnSync(
  process.execPath,
  ["scripts/run-governed-agent-mission.mjs"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      GNW_ENABLE_LOCAL_MISSION_LAB: "true",
    },
  },
);

if (child.error) {
  console.error("[MISSION-GUARD] FAIL — child process could not be started:", child.error.message);
  process.exit(1);
}

const output = String(child.stdout ?? "") + String(child.stderr ?? "");
if (child.status === 0) {
  console.error("[MISSION-GUARD] FAIL — direct mission runner exited successfully under NODE_ENV=production");
  console.error(output.slice(-4000));
  process.exit(1);
}

if (!output.includes("disabled in production")) {
  console.error("[MISSION-GUARD] FAIL — direct mission runner failed for an unexpected reason");
  console.error(output.slice(-4000));
  process.exit(1);
}

console.log("[MISSION-GUARD] PASS — production-mode direct invocation is denied before reading .env or opening network/database connections");
