import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const portalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(portalDir, "..", "..");
const githubRoot = resolve(repoRoot, "..");
const devKitRoot = resolve(githubRoot, "Infini-Dev-Kit");

function normalizeTarget(value: string): string {
  return value.replace(/\/+$/, "");
}

function toWsTarget(httpTarget: string): string {
  if (httpTarget.startsWith("https://")) {
    return `wss://${httpTarget.slice("https://".length)}`;
  }
  if (httpTarget.startsWith("http://")) {
    return `ws://${httpTarget.slice("http://".length)}`;
  }
  return httpTarget;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, portalDir, "");
  const workerHttpTarget = normalizeTarget(
    env.VITE_WORKER_API_ORIGIN ?? process.env.VITE_WORKER_API_ORIGIN ?? "http://127.0.0.1:8787",
  );
  const workerWsTarget = toWsTarget(workerHttpTarget);

  return {
    root: portalDir,
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        output: {
          experimentalMinChunkSize: 8_000,
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");

            if (normalizedId.includes("/Infini-Dev-Kit/frontend/")) {
              return "devkit";
            }
            if (normalizedId.includes("/apps/portal/i18n/")) {
              return "portal-i18n";
            }
            if (normalizedId.includes("/apps/shared/schema")) {
              return "shared-schema";
            }
            if (normalizedId.includes("/apps/portal/api/schema")) {
              return "portal-schema";
            }
            if (!normalizedId.includes("/node_modules/")) {
              return undefined;
            }
            if (normalizedId.includes("/node_modules/react/") || normalizedId.includes("/node_modules/react-dom/")) {
              return "react-core";
            }
            if (normalizedId.includes("/node_modules/@mantine/")) {
              return "mantine";
            }
            if (normalizedId.includes("/node_modules/@tanstack/")) {
              return "tanstack";
            }
            if (normalizedId.includes("/node_modules/i18next/")
              || normalizedId.includes("/node_modules/react-i18next/")
              || normalizedId.includes("/node_modules/i18next-browser-languagedetector/")
            ) {
              return "i18n";
            }
            if (normalizedId.includes("/node_modules/zod/")) {
              return "zod";
            }
            if (normalizedId.includes("/node_modules/@tabler/icons-react/")) {
              return "tabler-icons";
            }
            if (normalizedId.includes("/node_modules/@tiptap/") || normalizedId.includes("/node_modules/prosemirror")) {
              return "tiptap";
            }
            if (normalizedId.includes("/node_modules/echarts-for-react/")) {
              return "echarts-react";
            }
            if (normalizedId.includes("/node_modules/echarts/")) {
              return "echarts-core";
            }
            if (normalizedId.includes("/node_modules/@dnd-kit/")) {
              return "dnd-kit";
            }
            if (normalizedId.includes("/node_modules/swiper/")) {
              return "swiper";
            }
            if (normalizedId.includes("/node_modules/date-fns/")) {
              return "date-fns";
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: [
        {
          find: "@infini-dev-kit/frontend",
          replacement: resolve(devKitRoot, "frontend"),
        },
        {
          find: "@infini-dev-kit/utils",
          replacement: resolve(devKitRoot, "utils"),
        },
        {
          find: "@infini-dev-kit/api-client",
          replacement: resolve(devKitRoot, "api-client"),
        },
        {
          find: /^@guild\/shared$/,
          replacement: resolve(repoRoot, "apps/shared/index.ts"),
        },
        {
          find: /^@guild\/shared\/(.*)$/,
          replacement: resolve(repoRoot, "apps/shared/$1"),
        },
        {
          find: /^@portal$/,
          replacement: resolve(repoRoot, "apps/portal"),
        },
        {
          find: /^@portal\/(.*)$/,
          replacement: resolve(repoRoot, "apps/portal/$1"),
        },
      ],
    },
    server: {
      proxy: {
        "^/api/(?!.*\\.[^/]+(?:\\?.*)?$).*": {
          target: workerHttpTarget,
          changeOrigin: true,
        },
        "/ws": {
          target: workerWsTarget,
          ws: true,
        },
      },
    },
  };
});
