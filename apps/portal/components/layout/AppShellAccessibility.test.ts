import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("App shell accessibility structure", () => {
  it("keeps the route progress indicator hidden from assistive technology", () => {
    const source = readPortalFile("apps/portal/router.tsx");

    expect(source).toContain('<NavigationProgress aria-hidden="true" />');
  });

  it("labels the view-as selector input", () => {
    const source = readPortalFile("apps/portal/components/layout/ViewingAsSelector.tsx");

    expect(source).toContain('aria-label={t("viewingAs.label")}');
  });

  it("uses one app main landmark with a page h1", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appHeader = readPortalFile("apps/portal/components/layout/AppHeader.tsx");

    expect(appShell).toContain('<MantineAppShell.Main id="main-content"');
    expect(appShell).not.toContain('<main id="main-content"');
    expect(appHeader).toContain("<Title order={1}");
  });
});
