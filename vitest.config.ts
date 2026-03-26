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
      "@infini-dev-kit/react": path.resolve(repoRoot, "../Infini-Dev-Kit/packages/react"),
      "@infini-dev-kit/theme-core": path.resolve(repoRoot, "../Infini-Dev-Kit/packages/theme-core"),
      "@infini-dev-kit/adapter-mantine": path.resolve(repoRoot, "../Infini-Dev-Kit/packages/adapter-mantine"),
      "@infini-dev-kit/utils": path.resolve(repoRoot, "../Infini-Dev-Kit/packages/utils"),
      "@infini-dev-kit/api-client": path.resolve(repoRoot, "../Infini-Dev-Kit/packages/api-client"),
      react: path.resolve(repoRoot, "node_modules/react"),
      "react-dom": path.resolve(repoRoot, "node_modules/react-dom"),
      "@mantine/core": path.resolve(repoRoot, "node_modules/@mantine/core"),
      "@mantine/hooks": path.resolve(repoRoot, "node_modules/@mantine/hooks"),
      "@mantine/modals": path.resolve(repoRoot, "node_modules/@mantine/modals"),
      "@mantine/notifications": path.resolve(repoRoot, "node_modules/@mantine/notifications"),
      "@mantine/dates": path.resolve(repoRoot, "node_modules/@mantine/dates"),
      "@mantine/carousel": path.resolve(repoRoot, "node_modules/@mantine/carousel"),
      motion: path.resolve(repoRoot, "node_modules/motion"),
      "@tabler/icons-react": path.resolve(repoRoot, "node_modules/@tabler/icons-react"),
      lowlight: path.resolve(repoRoot, "node_modules/lowlight"),
      clsx: path.resolve(repoRoot, "node_modules/clsx"),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx"],
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
