import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = __dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@guild/shared": path.resolve(repoRoot, "apps/shared"),
      "@portal": path.resolve(repoRoot, "apps/portal"),
      react: path.resolve(repoRoot, "node_modules/react"),
      "react-dom": path.resolve(repoRoot, "node_modules/react-dom"),
      motion: path.resolve(repoRoot, "node_modules/motion"),
      "@tabler/icons-react": path.resolve(repoRoot, "node_modules/@tabler/icons-react"),
      lowlight: path.resolve(repoRoot, "node_modules/lowlight"),
      clsx: path.resolve(repoRoot, "node_modules/clsx"),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx"],
    exclude: ["apps/worker/tests/events.test.ts", "apps/worker/tests/contracts/**"],
    environmentMatchGlobs: [
      ["apps/portal/**/*.test.ts", "jsdom"],
      ["apps/portal/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["apps/portal/tests/setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: false,
  },
});
