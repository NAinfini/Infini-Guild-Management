import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  root: repoRoot,
  test: {
    environment: "node",
    include: ["packages/transport-http/src/**/*.test.ts"],
    restoreMocks: true,
  },
});
