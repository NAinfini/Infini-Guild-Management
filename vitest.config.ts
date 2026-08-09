import { realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = realpathSync.native(__dirname);

export default defineConfig({
  root: repoRoot,
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
    projects: [
      {
        extends: true,
        test: {
          name: "portal",
          include: ["apps/portal/**/*.test.ts", "apps/portal/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: [path.resolve(repoRoot, "apps/portal/tests/setup.ts")],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "apps/shared/**/*.test.ts",
            "apps/shared/**/*.test.tsx",
            "apps/worker/**/*.test.ts",
            "apps/worker/**/*.test.tsx",
            "scripts/**/*.test.ts",
          ],
          environment: "node",
        },
      },
    ],
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    pool: "threads",
    fileParallelism: true,
    maxWorkers: Math.min(4, availableParallelism()),
  },
});
