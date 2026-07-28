import { realpathSync } from "node:fs";
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
            // Node-native .test.mjs files remain on the separate `node --test` CI step.
            "scripts/**/*.test.ts",
          ],
          exclude: ["apps/worker/tests/events.test.ts", "apps/worker/tests/contracts/**"],
          environment: "node",
        },
      },
    ],
    setupFiles: [path.resolve(repoRoot, "apps/portal/tests/setup.ts")],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: false,
  },
});
