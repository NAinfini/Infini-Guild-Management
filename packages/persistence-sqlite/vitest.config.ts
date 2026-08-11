import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  root: repoRoot,
  test: {
    environment: "node",
    include: [
      "packages/kernel/src/kernel.test.ts",
      "packages/persistence-sqlite/src/**/*.test.ts",
      "apps/cloudflare/src/adapters/**/*.test.ts",
      "apps/vps/src/adapters/**/*.test.ts"
    ],
    restoreMocks: true,
    fileParallelism: true,
  },
});
