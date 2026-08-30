import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

/*
 * e2e 同时执行 apps/portal/dist 与 apps/cloudflare/dist/worker.mjs：前者经由
 * Cloudflare runtime 的 ASSETS 绑定作为站点输出，后者则是实际启动的 Worker。
 *
 * 好处见 config.ts，代价只有一条：产物过期就等于在测上一版代码，而且测出来
 * 是一片绿。这类「安静地测错东西」比红灯难查得多，所以这里不做任何兜底，
 * 只做一件事：任一源码比对应产物新就当场抛错，把该跑的命令写在报错里。
 */

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const PORTAL_DIST_DIR = resolve(repoRoot, "apps/portal/dist");
const WORKER_BUNDLE_PATH = resolve(repoRoot, "apps/cloudflare/dist/worker.mjs");

/** 参与打包的源码树。e2e 自己、产物目录和依赖都不算。 */
const PORTAL_SOURCE_DIRS = ["apps/portal", "apps/shared"] as const;
const WORKER_SOURCE_DIRS = [
  "apps/cloudflare/src",
  "apps/shared",
  "packages/application/src",
  "packages/kernel/src",
  "packages/persistence-sqlite/src",
  "packages/server/src",
  "packages/transport-http/src",
] as const;
const SKIPPED_DIRS = new Set(["dist", "e2e", "node_modules", "__tests__"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export type E2eBuildFreshnessPaths = Readonly<{
  portalDistDir: string;
  portalSourceDirs: readonly string[];
  workerBundlePath: string;
  workerSourceDirs: readonly string[];
}>;

const DEFAULT_PATHS: E2eBuildFreshnessPaths = {
  portalDistDir: PORTAL_DIST_DIR,
  portalSourceDirs: PORTAL_SOURCE_DIRS.map((dir) => resolve(repoRoot, dir)),
  workerBundlePath: WORKER_BUNDLE_PATH,
  workerSourceDirs: WORKER_SOURCE_DIRS.map((dir) => resolve(repoRoot, dir)),
};

async function newestMtimeMs(dir: string, skipTests: boolean): Promise<number> {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parentName = entry.parentPath.split(/[\\/]/).pop() ?? "";
    if (SKIPPED_DIRS.has(parentName)) continue;
    if (skipTests && TEST_FILE.test(entry.name)) continue;
    const relative = entry.parentPath.slice(dir.length);
    if (relative.split(/[\\/]/).some((segment) => SKIPPED_DIRS.has(segment))) continue;
    const { mtimeMs } = await stat(resolve(entry.parentPath, entry.name));
    if (mtimeMs > newest) newest = mtimeMs;
  }
  return newest;
}

async function newestSource(paths: readonly string[]): Promise<{ at: number; dir: string }> {
  let newestAt = 0;
  let newestDir = "";
  for (const dir of paths) {
    const at = await newestMtimeMs(dir, true);
    if (at > newestAt) {
      newestAt = at;
      newestDir = dir;
    }
  }
  return { at: newestAt, dir: newestDir };
}

async function fileMtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function assertE2eBuildFresh(paths: E2eBuildFreshnessPaths = DEFAULT_PATHS): Promise<void> {
  const builtAt = await newestMtimeMs(paths.portalDistDir, false);
  if (builtAt === 0) {
    throw new Error("apps/portal/dist 不存在或是空的。先跑 `pnpm build:cloudflare` 再跑 e2e。");
  }

  const portalSource = await newestSource(paths.portalSourceDirs);

  if (portalSource.at > builtAt) {
    throw new Error(
      `apps/portal/dist 比源码旧（${portalSource.dir} 最后改动于 ${new Date(portalSource.at).toISOString()}，`
      + `产物构建于 ${new Date(builtAt).toISOString()}）。e2e 跑的是产物，再跑就是在测上一版代码。`
      + " 先执行 `pnpm build:cloudflare`。",
    );
  }

  const workerBuiltAt = await fileMtimeMs(paths.workerBundlePath);
  if (workerBuiltAt === 0) {
    throw new Error("apps/cloudflare/dist/worker.mjs 不存在。先跑 `pnpm build:cloudflare` 再跑 e2e。");
  }

  const workerSource = await newestSource(paths.workerSourceDirs);
  if (workerSource.at > workerBuiltAt) {
    throw new Error(
      `apps/cloudflare/dist/worker.mjs 比源码旧（${workerSource.dir} 最后改动于 ${new Date(workerSource.at).toISOString()}，`
      + `产物构建于 ${new Date(workerBuiltAt).toISOString()}）。e2e 必须运行当前可部署的 Worker。`
      + " 先执行 `pnpm build:cloudflare`。",
    );
  }
}
