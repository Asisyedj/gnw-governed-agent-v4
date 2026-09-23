import { createServer } from "node:http";
import { ENV } from "./env.js";
import { buildApp } from "./app.js";
import { runMigrations } from "./db/index.js";

async function main() {
  await runMigrations();
  const app = await buildApp(ENV);
  const server = createServer(app);
  server.listen(ENV.port, () => {
    console.log(`[gnw] listening on port ${ENV.port} (${ENV.nodeEnv})`);
  });
  const shutdown = async (signal: string) => {
    console.log(`[gnw] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(err => {
  console.error("[gnw] fatal startup error:", err);
  process.exit(1);
});
