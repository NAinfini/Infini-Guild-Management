import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/worker/tests/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    pool: "forks",
  },
});
