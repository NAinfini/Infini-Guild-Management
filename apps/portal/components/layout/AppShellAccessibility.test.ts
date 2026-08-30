// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("App shell accessibility and access boundaries", () => {
  it("announces route loading once through the accessible progress control", () => {
    const router = readPortalFile("apps/portal/router.tsx");

    expect(router).toContain("<RouteProgress />");
    expect(router).toContain('role="status"');
    expect(router).toContain('aria-live="polite"');
  });

  it("keeps document language and locale state synchronized", () => {
    const shell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const i18n = readPortalFile("apps/portal/i18n/index.ts");

    expect(shell).toContain("void setI18nLocale(locale)");
    expect(i18n).toContain("document.documentElement.lang = locale");
    expect(i18n).toContain("document.documentElement.dataset.locale = locale");
  });

  it("keeps forced-password-reset sessions out of normal Portal side effects", () => {
    const shell = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(shell).toContain('const passwordChangeOnly = sessionScope === "password_change"');
    expect(shell).toContain('enabled: Boolean(user) && sessionScope === "normal"');
    expect(shell).toContain('{passwordChangeOnly ? null : <ImportantNoticeGate />}');
  });

  it("provides a focusable skip-link destination", () => {
    const shell = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(shell).toContain('href="#main-content"');
    expect(shell).toMatch(/<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  });

  it("filters navigation by permission and hides session-only routes in external view", () => {
    const shell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const adminNavigation = readPortalFile(
      "apps/portal/components/layout/AdminContextNavigation.tsx",
    );

    expect(shell).toContain("<AdminContextNavigationProvider>");
    expect(adminNavigation).toContain("ADMIN_CONTEXT_ROUTES.filter");
    expect(adminNavigation).toContain("isAdminContextRouteVisible");
    expect(shell).toContain("if (isExternalView && item.requiresSession)");
  });

});
