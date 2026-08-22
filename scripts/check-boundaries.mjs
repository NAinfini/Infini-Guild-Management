import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

const PACKAGE_ALIAS_OWNERS = new Map([
  ["@guild/shared", "apps/shared"],
  ["@guild/kernel", "packages/kernel"],
  ["@guild/server", "packages/server"],
  ["@guild/persistence-sqlite", "packages/persistence-sqlite"],
  ["@guild/transport-http", "packages/transport-http"],
  ["@guild/application", "packages/application"],
  ["@guild/cloudflare", "apps/cloudflare"],
  ["@guild/vps", "apps/vps"],
  ["@portal", "apps/portal"],
]);

/*
 * 单向依赖矩阵，就是仓库的架构契约：
 * shared 是全栈契约层，不依赖任何包；kernel 只依赖 shared 的契约；
 * server 承载领域逻辑；persistence/transport 是并列的实现层；
 * application 负责装配；两个运行时只消费装配结果；portal 只许碰 shared。
 * 新增包或新增依赖边必须显式登记，未登记一律判违规。
 */
const ALLOWED_PACKAGE_IMPORTS = new Map([
  ["apps/shared", []],
  ["packages/kernel", ["apps/shared"]],
  ["packages/server", ["packages/kernel", "apps/shared"]],
  ["packages/persistence-sqlite", ["packages/kernel", "packages/server", "apps/shared"]],
  ["packages/transport-http", ["packages/kernel", "packages/server", "apps/shared"]],
  ["packages/application", [
    "packages/kernel",
    "packages/server",
    "packages/persistence-sqlite",
    "packages/transport-http",
    "apps/shared",
  ]],
  ["apps/cloudflare", [
    "packages/application",
    "packages/kernel",
    "packages/server",
    "packages/persistence-sqlite",
    "packages/transport-http",
    "apps/shared",
  ]],
  ["apps/vps", [
    "packages/application",
    "packages/kernel",
    "packages/server",
    "packages/persistence-sqlite",
    "packages/transport-http",
    "apps/shared",
  ]],
  ["apps/portal", ["apps/shared"]],
  ["scripts", [
    "packages/application",
    "packages/server",
    "packages/persistence-sqlite",
    "apps/shared",
    "apps/vps",
  ]],
]);

// 双运行时奇偶测试需要在 CF 测试里加载 VPS 的测试出口，仅限测试文件。
const TEST_ONLY_PACKAGE_IMPORTS = new Map([
  ["apps/cloudflare", ["apps/vps"]],
]);

// vite 配置在别名生效前由 Node 解析执行，只能用相对路径取 shared 的品牌常量。
const ALLOWED_RELATIVE_CROSSINGS = new Map([
  ["apps/portal/vite.config.ts", ["apps/shared"]],
]);

function repositoryFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0").filter(Boolean);
}

export function findBoundaryViolations(
  files,
  read = (file) => readFileSync(file, "utf8"),
  exists = existsSync,
) {
  const violations = [];
  for (const rawFile of files) {
    const file = rawFile.replaceAll("\\", "/");
    if (!exists(rawFile) || !isCheckedSource(file)) continue;
    const owner = sourceOwner(file);
    if (!owner) continue;
    const serverModule = serverModuleOwner(file);
    for (const specifier of importSpecifiers(read(rawFile))) {
      if (/^@guild\/[^/]+\/src(?:\/|$)/.test(specifier)) {
        violations.push(`${file}: imports private package src ${specifier}`);
        continue;
      }
      const aliasViolation = packageAliasViolation(file, owner, specifier);
      if (aliasViolation) {
        violations.push(aliasViolation);
        continue;
      }
      if (serverModule && isSourceModuleSpecifier(specifier)) {
        const packageModule = /^@guild\/server\/modules\/([^/]+)(?:\/(.+))?$/.exec(specifier);
        if (packageModule && packageModule[1] !== serverModule && packageModule[2]) {
          violations.push(`${file}: imports private server module path ${specifier}`);
          continue;
        }
      }
      if (!specifier.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), stripQueryAndHash(specifier)));
      if (serverModule && isSourceModuleSpecifier(specifier)) {
        const targetModule = serverModuleOwner(target);
        if (
          targetModule
          && targetModule !== serverModule
          && !isServerModulePublicEntry(target, targetModule)
        ) {
          violations.push(`${file}: crosses server module boundary into ${target}`);
          continue;
        }
      }
      const targetOwner = sourceOwner(target);
      if (
        targetOwner
        && targetOwner !== owner
        && ALLOWED_PACKAGE_IMPORTS.has(targetOwner)
        && !isAllowedRelativeCrossing(file, targetOwner)
      ) {
        violations.push(`${file}: crosses into ${target}`);
      }
    }
  }
  return violations;
}

function packageAliasViolation(file, owner, specifier) {
  const aliasOwner = packageAliasOwner(specifier);
  if (!aliasOwner) return null;
  if (aliasOwner === "unregistered") {
    return `${file}: imports unregistered package alias ${specifier}`;
  }
  if (aliasOwner === owner) return null;
  if (ALLOWED_PACKAGE_IMPORTS.get(owner)?.includes(aliasOwner)) return null;
  if (isTestFile(file) && TEST_ONLY_PACKAGE_IMPORTS.get(owner)?.includes(aliasOwner)) return null;
  return `${file}: imports ${specifier} outside the allowed package dependency matrix`;
}

/*
 * 相对路径跨包一律走公共入口，仅两类例外：
 * 显式登记的构建期文件，以及测试/工具文件对 scripts 共享工具的引用——
 * scripts 不是包、没有公共入口可走，但产物代码（src 内非测试文件）不许碰它。
 */
function isAllowedRelativeCrossing(file, targetOwner) {
  if (ALLOWED_RELATIVE_CROSSINGS.get(file)?.includes(targetOwner)) return true;
  if (targetOwner !== "scripts") return false;
  return isTestFile(file) || !/^(?:apps|packages)\/[^/]+\/src\//.test(file);
}

function packageAliasOwner(specifier) {
  if (specifier === "@portal" || specifier.startsWith("@portal/")) return "apps/portal";
  const match = /^@guild\/([^/]+)/.exec(specifier);
  if (!match) return null;
  return PACKAGE_ALIAS_OWNERS.get(`@guild/${match[1]}`) ?? "unregistered";
}

function isTestFile(file) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function isCheckedSource(file) {
  return SOURCE_EXTENSIONS.has(extname(file).toLowerCase());
}

function sourceOwner(file) {
  const packageMatch = /^(apps|packages)\/([^/]+)(?:\/|$)/.exec(file);
  if (packageMatch) return `${packageMatch[1]}/${packageMatch[2]}`;
  return file.startsWith("scripts/") ? "scripts" : null;
}

function serverModuleOwner(file) {
  return /^packages\/server\/src\/modules\/([^/]+)(?:\/|$)/.exec(file)?.[1] ?? null;
}

function stripQueryAndHash(specifier) {
  return specifier.split(/[?#]/, 1)[0];
}

function isSourceModuleSpecifier(specifier) {
  const extension = extname(stripQueryAndHash(specifier)).toLowerCase();
  return extension === "" || SOURCE_EXTENSIONS.has(extension);
}

function isServerModulePublicEntry(target, moduleName) {
  const entry = `packages/server/src/modules/${moduleName}/public`;
  return target === `${entry}.js` || target === `${entry}.ts`;
}

function importSpecifiers(source) {
  const values = new Set();
  for (const pattern of [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*(?:\(\s*)?["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) values.add(match[1]);
  }
  return values;
}

export function main() {
  const violations = findBoundaryViolations(repositoryFiles());
  for (const violation of violations) console.error(`[boundary-check] ❌ ${violation}`);
  if (violations.length > 0) return 1;
  console.log("[boundary-check] ✅ Source and test imports use public package boundaries.");
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
