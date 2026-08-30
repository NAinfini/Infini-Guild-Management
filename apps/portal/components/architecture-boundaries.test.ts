// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === "dist" || entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...listSourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) files.push(path);
  }
  return files;
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const rawApiImportFragments = [
  "/api/client",
  "/api/queries/",
  "/api/mutations/",
  "@portal/api/queries",
  "@portal/api/mutations",
];

function importsRawApi(source: string): boolean {
  return rawApiImportFragments.some((fragment) => source.includes(fragment));
}

const rawTimeConversionFragments = [
  "getTimezoneOffset",
  "toISOString().slice(",
  ".toLocaleDateString(",
  ".toLocaleTimeString(",
  "Intl.DateTimeFormat(",
];

describe("portal architecture boundaries", () => {
  it("keeps components out of the raw API client layer", () => {
    const offenders = listSourceFiles(resolve(repoRoot, "apps/portal/components"))
      .filter((path) => importsRawApi(readFileSync(path, "utf8")))
      .map((path) => relative(repoRoot, path).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("keeps the raw API restriction in the lint boundary", () => {
    const eslintConfig = readProjectFile("eslint.config.js");

    expect(eslintConfig).toContain("**/api/client");
    expect(eslintConfig).toContain("**/api/queries/*");
    expect(eslintConfig).toContain("**/api/mutations/*");
  });

  it("keeps UTC-to-local conversion in the shared datetime utility", () => {
    const exempt = new Set([
      "apps/portal/utils/datetime.ts",
      "apps/portal/components/feature/admin/api-test/request-builders.ts",
    ]);
    const offenders = listSourceFiles(resolve(repoRoot, "apps/portal"))
      .map((path) => relative(repoRoot, path).replace(/\\/g, "/"))
      .filter((path) => !exempt.has(path) && !path.startsWith("apps/portal/e2e/"))
      .filter((path) => rawTimeConversionFragments.some((fragment) => readProjectFile(path).includes(fragment)));

    expect(offenders).toEqual([]);
  });

  it("disables Zod JIT before the application module is loaded", () => {
    const html = readProjectFile("apps/portal/index.html");
    const jitlessScript = html.indexOf('<script src="/zod-csp.js"></script>');
    const moduleEntry = html.indexOf('<script type="module" src="/main.tsx"></script>');

    expect(jitlessScript).toBeGreaterThanOrEqual(0);
    expect(moduleEntry).toBeGreaterThan(jitlessScript);
    expect(readProjectFile("apps/portal/public/zod-csp.js"))
      .toContain("__zod_globalConfig = { jitless: true }");
  });
});
