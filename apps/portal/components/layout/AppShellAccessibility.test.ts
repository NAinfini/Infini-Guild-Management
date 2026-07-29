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

  it("keeps the document language and locale selector in sync", () => {
    const source = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(source).toContain("document.documentElement.dataset.locale = locale");
    expect(source).toContain("document.documentElement.lang = locale");
  });

  it("keeps AppHeader as the only page-title source", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appHeader = readPortalFile("apps/portal/components/layout/AppHeader.tsx");
    const pageLayout = readPortalFile("apps/portal/components/layout/PageLayout.tsx");

    expect(appShell).toContain('<MantineAppShell.Main id="main-content"');
    expect(appShell).not.toContain('<main id="main-content"');
    expect(appShell).toContain("activePageTitle");
    expect(appHeader).toContain("activePageTitle");
    expect(appHeader).toContain("<Title order={1}");
    expect(pageLayout).not.toContain("page-layout__title");
    expect(pageLayout).not.toContain("page-layout__subtitle");
    expect(pageLayout).not.toContain("page-layout__icon");
    expect(pageLayout).not.toContain("<header");
  });

  it("keeps the visual header and Mantine content offset at the same compact height", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");
    const scale = readPortalFile("apps/portal/styles/scale.css");

    expect(appShell).toContain("header={{ height: 48 }}");
    expect(scale).toMatch(/--header-height:\s*48px\b/);
    expect(scale).toMatch(/--header-height-mobile:\s*48px\b/);
    expect(appShellCss).not.toMatch(/\.app-header\s*\{[^}]*position:\s*relative/);
    expect(appShellCss).toMatch(
      /\.app-content\.app-content\s*\{[^}]*height:\s*100dvh/,
    );
  });

  it("keeps the shell title compact and desktop workspaces broad", () => {
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");
    const scale = readPortalFile("apps/portal/styles/scale.css");

    expect(appShellCss).toMatch(
      /\.app-header__page-title\s*\{[^}]*font-size:\s*var\(--text-h2\)/,
    );
    expect(scale).toMatch(/--content-width-reading:\s*1120px\b/);
    expect(scale).toMatch(/--content-width-standard:\s*1800px\b/);
    expect(scale).toMatch(/--content-width-wide:\s*2200px\b/);
  });

  it("uses one route registry and does not apply generic route entrance motion", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");

    expect(appShell).toContain("PORTAL_ROUTES");
    expect(appShell).toContain("findPortalRoute");
    expect(appShell).not.toContain("HEADER_TITLE_OVERRIDES");
    expect(appShell).not.toContain("AnimatedOutlet");
    expect(appShellCss).not.toContain("route-slide-in");
  });

  it("owns the only header-to-content gap at the shell level", () => {
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");
    const pageLayoutCss = readPortalFile("apps/portal/components/layout/PageLayout.css");

    expect(appShellCss).toMatch(/--shell-content-gap:\s*16px/);
    expect(appShellCss).toMatch(/--shell-content-gap:\s*12px/);
    expect(appShellCss).toContain("padding-top: var(--shell-content-gap)");
    expect(pageLayoutCss).not.toMatch(/padding-top:/);
    expect(pageLayoutCss).not.toMatch(/margin-top:/);
  });
});
