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
          exclude: ["apps/portal/components/feature/events/RecurringTemplateFormModal.helpers.test.ts"],
          environment: "jsdom",
          setupFiles: [path.resolve(repoRoot, "apps/portal/tests/setup.ts")],
          /* Node 自带的 localStorage 全局挡在 jsdom 前面。vitest 搬运 window 的键时
           * 会跳过 globalThis 上已存在的同名键，而 Node 无条件定义 localStorage——
           * 没有 --localstorage-file 时它取出来是 undefined，于是 stores、i18n、
           * ThemeProvider 这些读写偏好的模块在测试里全线 TypeError。关掉这个全局，
           * jsdom 自己的 Storage 才搬得进来；只有本项目跑 jsdom，另两个项目不需要。
           * execArgv 默认是空数组，标志写在命令行进不了 worker 线程。 */
          execArgv: ["--no-experimental-webstorage"],
        },
      },
      {
        extends: true,
        test: {
          // Changing TZ takes effect for a Node process, not for a Vitest worker thread.
          // This file deliberately verifies DST behavior in a named timezone.
          name: "portal-timezone",
          include: ["apps/portal/components/feature/events/RecurringTemplateFormModal.helpers.test.ts"],
          environment: "node",
          pool: "forks",
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "apps/shared/**/*.test.ts",
            "apps/shared/**/*.test.tsx",
            "scripts/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "backend",
          include: [
            "packages/**/*.test.ts",
            "apps/cloudflare/**/*.test.ts",
            "apps/vps/**/*.test.ts",
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
