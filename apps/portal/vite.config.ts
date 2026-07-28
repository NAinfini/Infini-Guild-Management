import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { defineConfig, loadEnv, type Plugin } from "vite";

const portalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(portalDir, "..", "..");
export const API_PROXY_CONTEXT = "^/api(?:/|$)";
const SOURCE_MODULE_PATH_PATTERN = /\/[^/?#]+\.[^/?#]+$/;

export const ECHARTS_CHUNK_BUDGET = {
  rawBytes: 575_000,
  gzipBytes: 200_000,
} as const;

export type LogicalChunkSize = {
  name: string;
  rawBytes: number;
  gzipBytes: number;
};

export function findEChartsChunkBudgetViolation(
  chunks: readonly LogicalChunkSize[],
): string | null {
  const chunk = chunks.find(({ name }) => name === "echarts-core");
  if (!chunk) return null;

  const exceeded: string[] = [];
  if (chunk.rawBytes > ECHARTS_CHUNK_BUDGET.rawBytes) {
    exceeded.push(`raw ${chunk.rawBytes} > ${ECHARTS_CHUNK_BUDGET.rawBytes} bytes`);
  }
  if (chunk.gzipBytes > ECHARTS_CHUNK_BUDGET.gzipBytes) {
    exceeded.push(`gzip ${chunk.gzipBytes} > ${ECHARTS_CHUNK_BUDGET.gzipBytes} bytes`);
  }
  return exceeded.length > 0
    ? `ECharts logical chunk exceeded its bundle budget: ${exceeded.join(", ")}`
    : null;
}

function echartsBundleBudgetPlugin(): Plugin {
  return {
    name: "echarts-bundle-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const sizes = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((chunk) => ({
          name: chunk.name,
          rawBytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).byteLength,
        }));
      const violation = findEChartsChunkBudgetViolation(sizes);
      if (violation) this.error(violation);
    },
  };
}

export function shouldProxyApiRequest(url: string): boolean {
  const queryIndex = url.search(/[?#]/);
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  return new RegExp(API_PROXY_CONTEXT).test(pathname) && !SOURCE_MODULE_PATH_PATTERN.test(pathname);
}

export function replaceSiteConfigPlaceholders(
  html: string,
  siteName: string,
  siteLogoUrl: string,
): string {
  return html
    .replaceAll("{{SITE_NAME}}", siteName)
    .replaceAll("{{SITE_LOGO_URL}}", siteLogoUrl);
}

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
  const localSiteName = env.VITE_SITE_NAME?.trim() || "Infini Guild";
  const localSiteLogoUrl = env.VITE_SITE_LOGO_URL?.trim() || "/guild-logo.webp";

  return {
    root: portalDir,
    plugins: [
      {
        name: "local-site-config",
        apply: "serve",
        transformIndexHtml(html) {
          return replaceSiteConfigPlaceholders(html, localSiteName, localSiteLogoUrl);
        },
      },
      echartsBundleBudgetPlugin(),
      tailwindcss(),
      react(),
    ],
    build: {
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");

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
            if (normalizedId.includes("/node_modules/@mantine/core") || normalizedId.includes("/node_modules/@mantine/hooks") || normalizedId.includes("/node_modules/@mantine/notifications")) {
              return "mantine-core";
            }
            if (normalizedId.includes("/node_modules/@mantine/")) {
              return "mantine-optional";
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
            if (normalizedId.includes("/node_modules/motion/")) {
              return "motion";
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
            if (normalizedId.includes("/node_modules/date-fns/")) {
              return "date-fns";
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      dedupe: ["react", "react-dom", "@mantine/core", "@mantine/hooks"],
      alias: [
        // Peer dep deduplication
        { find: "react", replacement: resolve(repoRoot, "node_modules/react") },
        { find: "react-dom", replacement: resolve(repoRoot, "node_modules/react-dom") },
        { find: /^@mantine\/core$/, replacement: resolve(repoRoot, "node_modules/@mantine/core") },
        { find: /^@mantine\/hooks$/, replacement: resolve(repoRoot, "node_modules/@mantine/hooks") },
        { find: "motion", replacement: resolve(repoRoot, "node_modules/motion") },
        { find: /^@tanstack\/react-table$/, replacement: resolve(repoRoot, "node_modules/@tanstack/react-table") },
        { find: /^@tiptap\/(.*)$/, replacement: resolve(repoRoot, "node_modules/@tiptap/$1") },
        { find: /^@tabler\/icons-react$/, replacement: resolve(repoRoot, "node_modules/@tabler/icons-react") },
        { find: "lowlight", replacement: resolve(repoRoot, "node_modules/lowlight") },
        { find: "clsx", replacement: resolve(repoRoot, "node_modules/clsx") },
        // Portal internal aliases
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
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "@mantine/core",
        "@mantine/hooks",
        "mantine-contextmenu",
      ],
    },
    server: {
      proxy: {
        [API_PROXY_CONTEXT]: {
          target: workerHttpTarget,
          changeOrigin: true,
          bypass(req) {
            if (!req.url || shouldProxyApiRequest(req.url)) return undefined;
            return req.url;
          },
          configure(proxy) {
            // Prevent ECONNREFUSED from bubbling into viteErrorMiddleware,
            // where JSON.stringify on the DevEnvironment error object causes a
            // "Converting circular structure to JSON" crash (Vite 8 regression).
            proxy.on("error", (err, _req, res) => {
              if (!("headersSent" in res) || (res as import("node:http").ServerResponse).headersSent) return;
              (res as import("node:http").ServerResponse).writeHead(503, { "Content-Type": "application/json" });
              (res as import("node:http").ServerResponse).end(
                JSON.stringify({ error: "Worker backend unavailable", detail: (err as NodeJS.ErrnoException).code }),
              );
            });
          },
        },
        "/ws": {
          target: workerWsTarget,
          ws: true,
          configure(proxy) {
            proxy.on("error", (_err, _req, socket) => {
              // Swallow WebSocket proxy errors when the backend isn't running.
              if (socket && typeof (socket as import("node:net").Socket).destroy === "function") {
                (socket as import("node:net").Socket).destroy();
              }
            });
          },
        },
      },
    },
  };
});
