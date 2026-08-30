// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalFile(path: string): string {
  return readFileSync(resolve(process.cwd(), `apps/portal/${path}`), "utf8");
}

describe("public landing route", () => {
  it("moves skip-link focus into landing content", () => {
    const landing = readPortalFile("components/pages/LandingPage.tsx");

    expect(landing).toContain('href="#landing-main"');
    expect(landing).toContain('<main id="landing-main" tabIndex={-1}');
  });
});
