import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function listSourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      result.push(fullPath);
    }
  }
  return result;
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const forbiddenRawApiImportFragments = [
  "/api/client",
  "/api/queries/",
  "/api/mutations/",
  "@portal/api/queries",
  "@portal/api/mutations",
];

function hasForbiddenRawApiImport(source: string): boolean {
  return forbiddenRawApiImportFragments.some((fragment) => source.includes(fragment));
}

describe("portal architecture boundaries", () => {
  it("detects forbidden raw API query and mutation imports in component source", () => {
    expect(hasForbiddenRawApiImport('import { apiRequest } from "../../api/client";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { listEvents } from "../../api/queries/events";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { saveEvent } from "../../api/mutations/events";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { listEvents } from "@portal/api/queries/events";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { saveEvent } from "@portal/api/mutations/events";')).toBe(true);
  });

  it("keeps portal components out of the raw API client layer", () => {
    const componentRoot = resolve(repoRoot, "apps/portal/components");
    const offenders = listSourceFiles(componentRoot)
      .filter((filePath) => !filePath.endsWith("architecture-boundaries.test.ts"))
      .filter((filePath) => hasForbiddenRawApiImport(readFileSync(filePath, "utf8")))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("enforces raw API client import restrictions through eslint", () => {
    const eslintConfig = readProjectFile("eslint.config.js");

    expect(eslintConfig).toContain("**/api/client");
    expect(eslintConfig).toContain("**/api/queries/*");
    expect(eslintConfig).toContain("**/api/mutations/*");
  });
});
