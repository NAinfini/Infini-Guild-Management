import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

/*
 * e2e 打的是 apps/portal/dist——Cloudflare runtime 通过 ASSETS 绑定把它当站点吐出来。
 *
 * 好处见 config.ts，代价只有一条：产物过期就等于在测上一版代码，而且测出来
 * 是一片绿。这类「安静地测错东西」比红灯难查得多，所以这里不做任何兜底，
 * 只做一件事：源码比产物新就当场抛错，把该跑的命令写在报错里。
 */

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const DIST_DIR = resolve(repoRoot, "apps/portal/dist");

/** 参与打包的源码树。e2e 自己、产物目录和依赖都不算。 */
const SOURCE_DIRS = ["apps/portal", "apps/shared"] as const;
const SKIPPED_DIRS = new Set(["dist", "e2e", "node_modules", "__tests__"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

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

export async function assertPortalBundleFresh(): Promise<void> {
  const builtAt = await newestMtimeMs(DIST_DIR, false);
  if (builtAt === 0) {
    throw new Error("apps/portal/dist 不存在或是空的。先跑 `pnpm build` 再跑 e2e。");
  }

  let newestSourceAt = 0;
  let newestSourceDir = "";
  for (const dir of SOURCE_DIRS) {
    const at = await newestMtimeMs(resolve(repoRoot, dir), true);
    if (at > newestSourceAt) {
      newestSourceAt = at;
      newestSourceDir = dir;
    }
  }

  if (newestSourceAt > builtAt) {
    throw new Error(
      `apps/portal/dist 比源码旧（${newestSourceDir} 最后改动于 ${new Date(newestSourceAt).toISOString()}，`
      + `产物构建于 ${new Date(builtAt).toISOString()}）。e2e 跑的是产物，再跑就是在测上一版代码。`
      + " 先执行 `pnpm build`。",
    );
  }
}
