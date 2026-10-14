import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/kill-switch-operational-drill.test.ts"],
    exclude: configDefaults.exclude,
    fileParallelism: false,
    reporters: ["verbose"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
