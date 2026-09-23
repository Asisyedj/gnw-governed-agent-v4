import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/server/**/*.ts"],
      exclude: ["src/server/db/schema.ts", "src/server/app.ts"],
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
    reporters: ["verbose"],
    testTimeout: 10_000,
  },
});
