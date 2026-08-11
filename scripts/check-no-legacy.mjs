import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PATHS = new Set([
  "scripts/create-admin.mjs",
  "scripts/create-admin.test.ts",
  "scripts/reset-e2e-slot-state.mjs",
]);

const FORBIDDEN_REFERENCES = [
  "apps/worker/",
  "apps\\worker\\",
  "@worker/",
  "check-worker-config",
  "reset-e2e-slot-state",
];

const SCANNABLE_EXTENSIONS = new Set([".cjs", ".js", ".json", ".jsonc", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
const SELF = new Set(["scripts/check-no-legacy.mjs", "scripts/check-no-legacy.test.ts"]);

function repositoryFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0").filter(Boolean);
}

export function findLegacyViolations(
  files,
  read = (file) => readFileSync(file, "utf8"),
  exists = existsSync,
) {
  const violations = [];
  for (const rawFile of files) {
    const file = rawFile.replace(/\\/g, "/");
    if (!exists(rawFile)) continue;
    if (file.startsWith("apps/worker/") || FORBIDDEN_PATHS.has(file)) {
      violations.push(`${file}: legacy source path`);
      continue;
    }
    if (SELF.has(file) || !SCANNABLE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (!(file.startsWith("apps/") || file.startsWith("packages/") || file.startsWith("scripts/") || file.startsWith(".github/") || !file.includes("/"))) continue;
    const content = read(rawFile);
    for (const reference of FORBIDDEN_REFERENCES) {
      if (content.includes(reference)) violations.push(`${file}: references ${reference}`);
    }
  }
  return violations;
}

export function main() {
  const violations = findLegacyViolations(repositoryFiles());
  for (const violation of violations) console.error(`[legacy-check] ❌ ${violation}`);
  if (violations.length > 0) return 1;
  console.log("[legacy-check] ✅ No legacy runtime source or references found.");
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
