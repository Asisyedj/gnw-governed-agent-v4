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
      exclude: [
        "src/server/db/schema.ts",
        "src/server/app.ts",
        "src/server/routes/**",
      ],
      thresholds: { lines: 60, functions: 60, branches: 50, statements: 60 },
    },
    reporters: ["verbose"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
