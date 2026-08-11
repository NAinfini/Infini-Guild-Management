import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

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
        && /^(?:apps|packages)\/[^/]+\/src(?:\/|$)/.test(target)
      ) {
        violations.push(`${file}: crosses into ${target}`);
      }
    }
  }
  return violations;
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
