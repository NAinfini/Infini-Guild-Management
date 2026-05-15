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

describe("portal architecture boundaries", () => {
  it("keeps portal components out of the raw API client layer", () => {
    const componentRoot = resolve(repoRoot, "apps/portal/components");
    const offenders = listSourceFiles(componentRoot)
      .filter((filePath) => !filePath.endsWith("architecture-boundaries.test.ts"))
      .filter((filePath) => readFileSync(filePath, "utf8").includes("/api/client"))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("enforces raw API client import restrictions through eslint", () => {
    const eslintConfig = readProjectFile("eslint.config.js");

    expect(eslintConfig).toContain("**/api/client");
  });
});
