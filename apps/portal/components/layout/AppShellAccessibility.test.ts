// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("App shell accessibility structure", () => {
  it("uses one visible route progress indicator and an assistive loading announcement", () => {
    const source = readPortalFile("apps/portal/router.tsx");
    const styles = readPortalFile("apps/portal/components/ui/route-progress.css");

    expect(source).toContain("<RouteProgress />");
    expect(source).toContain('<span className="sr-only" role="status" aria-live="polite">');
    expect(source).not.toContain('className="route-loading"');
    expect(styles).not.toContain(".route-loading");
    expect(styles).toContain(".route-progress[data-active]");
  });

  it("labels the view-as selector input", () => {
    const source = readPortalFile("apps/portal/components/layout/ViewingAsSelector.tsx");

    expect(source).toContain('aria-label={t("viewingAs.label")}');
  });

  it("keeps the document language and locale selector in sync", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const i18n = readPortalFile("apps/portal/i18n/index.ts");

    expect(appShell).toContain("void setI18nLocale(locale)");
    expect(i18n).toContain("document.documentElement.dataset.locale = locale");
    expect(i18n).toContain("document.documentElement.lang = locale");
  });

  it("refreshes member lists and the current profile after realtime badge changes", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(appShell).toMatch(
      /member_badge:\s*\[queryKeys\.users\.all,\s*queryKeys\.myProfile\.all\]/,
    );
  });

  it("shows a localized warning when session revalidation fails", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(appShell).toContain('notifyWarning(t("admin:message.sessionRefreshFailed"))');
    expect(appShell).not.toContain("[auth] Session revalidation failed");
  });

  it("keeps forced-password-reset sessions out of ordinary Portal side effects", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(appShell).toContain('const passwordChangeOnly = sessionScope === "password_change"');
    expect(appShell).toContain('enabled: Boolean(user) && sessionScope === "normal"');
    expect(appShell).toContain('enabled: canSwitchView && sessionScope === "normal"');
    expect(appShell).toContain("{passwordChangeOnly ? null : <ImportantNoticeGate />}");
  });

  it("keeps AppHeader as the only page-title source", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appHeader = readPortalFile("apps/portal/components/layout/AppHeader.tsx");
    const pageLayout = readPortalFile("apps/portal/components/layout/PageLayout.tsx");

    expect(appShell).toContain('<main id="main-content"');
    expect(appShell).not.toContain(["Man", "tine", "AppShell"].join(""));
    expect(appShell).toContain("activePageTitle");
    expect(appHeader).toContain("activePageTitle");
    expect(appHeader).toContain('<h1 className="app-header__page-title">');
    expect(pageLayout).not.toContain("page-layout__title");
    expect(pageLayout).not.toContain("page-layout__subtitle");
    expect(pageLayout).not.toContain("page-layout__icon");
    expect(pageLayout).not.toContain("<header");
  });

  it("keeps the visual header and content grid on one height contract", () => {
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");
    const scale = readPortalFile("apps/portal/styles/scale.css");

    expect(scale).toMatch(/--app-header-height:\s*72px\b/);
    expect(scale).toMatch(/--header-height:\s*var\(--app-header-height\)/);
    expect(scale).toMatch(/--header-height-mobile:\s*var\(--app-header-height\)/);
    expect(appShellCss).toMatch(
      /\.app-header\s*\{[^}]*height:\s*var\(--app-header-height\)/,
    );
    expect(appShellCss).toMatch(
      /\.app-shell-root\s*\{[^}]*grid-template-rows:\s*var\(--app-header-height\)\s+minmax\(0,\s*1fr\)/s,
    );
    expect(appShellCss).toMatch(
      /\.app-content\.app-content\s*\{[^}]*height:\s*100%/,
    );
  });

  it("gives every routed workspace the same definite shell height", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");

    expect(appShell).toContain('<div className="app-main">');
    expect(appShell).not.toContain("fillsViewport");
    expect(appShellCss).toMatch(/\.app-main\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
    expect(appShellCss).not.toContain(".app-main--fill");
  });

  it("keeps scrolling out of the shell so the page workspace owns it", () => {
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");
    const contentRule = appShellCss.match(/\.app-content\.app-content\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(contentRule).toContain("min-width: 0");
    expect(contentRule).toContain("overflow-x: clip");
    expect(contentRule).toContain("overflow-y: hidden");
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

  it("uses compact navigation through tablet portrait without changing the phone header breakpoint", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appSidebar = readPortalFile("apps/portal/components/layout/AppSidebar.tsx");

    expect(appSidebar).toContain("export const MOBILE_BREAKPOINT_PX = 767");
    expect(appSidebar).toContain("export const COMPACT_NAV_BREAKPOINT_PX = 1023");
    expect(appShell).toContain(
      "const usesCompactNavigation = useMediaQuery(`(max-width: ${COMPACT_NAV_BREAKPOINT_PX}px)`)",
    );
    expect(appShell).toContain("data-compact-navigation={usesCompactNavigation || undefined}");
    expect(appShell).toContain("{!usesCompactNavigation ? (");
    expect(appShell).toContain("{usesCompactNavigation ? (");
  });

  it("uses one route registry and one bounded route entrance motion", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");

    expect(appShell).toContain("PORTAL_ROUTES");
    expect(appShell).toContain("findPortalRoute");
    expect(appShell).not.toContain("HEADER_TITLE_OVERRIDES");
    expect(appShell).not.toContain("AnimatedOutlet");
    expect(appShell).toContain('key={pathname}');
    expect(appShellCss).toMatch(/\.app-route-container\s*\{[^}]*animation:\s*app-route-arrive var\(--motion-panel\) both/s);
    expect(appShellCss).toMatch(/@keyframes app-route-arrive\s*\{[\s\S]*translateY\(4px\)/);
    expect(appShellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-route-container\s*\{[^}]*animation:\s*none/s);
  });

  it("updates the route title and moves focus to the visible page heading after navigation", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appHeader = readPortalFile("apps/portal/components/layout/AppHeader.tsx");

    expect(appShell).toContain('document.title = siteName ? `${activePageTitle} · ${siteName}` : activePageTitle');
    expect(appShell).toContain('document.querySelector<HTMLElement>(".app-header__page-title")');
    expect(appShell).toContain("requestAnimationFrame");
    expect(appHeader).toContain('tabIndex={-1}');
  });

  it("switches the single shell navigation to the permission-filtered admin context", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const sidebar = readPortalFile("apps/portal/components/layout/AppSidebar.tsx");
    const adminPage = readPortalFile("apps/portal/components/pages/AdminPage.tsx");
    const adminNavigation = readPortalFile(
      "apps/portal/components/layout/AdminContextNavigation.tsx",
    );

    expect(appShell).toContain("<AdminContextNavigationProvider>");
    expect(appShell).toContain("useAdminContextNavigationModel");
    expect(appShell).toContain("adminNavigation.isAdminContext ? adminNavigation.sidebarGroups");
    expect(appShell).toContain("onReturnToPortal={adminNavigation.isAdminContext");
    expect(adminNavigation).toContain("ADMIN_CONTEXT_ROUTES.filter");
    expect(adminNavigation).toContain("isAdminContextRouteVisible");
    expect(sidebar).toContain('t("nav.returnToPortal")');
    expect(adminPage).not.toContain("<Tabs");
    expect(adminPage).not.toContain("Tabs.Panel");
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

  it("uses the shared responsive page gutter for every route", () => {
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");

    expect(appShellCss).toMatch(/--shell-page-padding:\s*16px/);
    expect(appShellCss).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*--shell-page-padding:\s*32px/,
    );
  });

  it("limits decorative route scenes to authored chapters and fades non-event workspaces into the ground", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");
    const appHeader = readPortalFile("apps/portal/components/layout/AppHeader.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");
    const routeMetadata = readPortalFile("apps/portal/components/layout/route-metadata.ts");

    expect(appShell).toContain("visualScene={activeRoute.visualScene}");
    expect(appShell).toContain('className="app-shell__scene"');
    expect(appShell).toContain("data-visual-scene={activeRoute.visualScene}");
    expect(appHeader).not.toContain("VisualThemeHeaderScene");
    expect(appHeader).not.toContain('className="app-header__scene"');
    expect(appShellCss).toMatch(/\.app-shell__scene\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
    expect(appShellCss).toMatch(
      /\.app-header--with-scene\s*\{[^}]*border-bottom-color:\s*transparent[^}]*background:\s*transparent/s,
    );
    expect(appShellCss).toMatch(
      /\.app-header--with-scene::before\s*\{[^}]*background:\s*var\(--surface-overlay\)[^}]*opacity:\s*0\.22/s,
    );
    expect(appShellCss).not.toContain(".app-header__scene");
    expect(appShellCss).toMatch(
      /\.app-shell__scene::after\s*\{[^}]*var\(--surface-base\) 18%/,
    );
    expect(appShellCss).toMatch(
      /\[data-theme="light"\] \.app-shell__scene::after\s*\{[^}]*var\(--surface-base\) 28%/,
    );
    expect(appShellCss).not.toContain(':not([data-visual-scene="events"])');
    expect(routeMetadata.match(/visualScene:/g)).toHaveLength(12);
    expect(routeMetadata).toContain('visualScene: "dashboard"');
    expect(routeMetadata).toContain('visualScene: "admin"');
    expect(appShellCss).toContain(".app-content.app-content.app-content--with-scene");
    expect(appShellCss).not.toContain(".app-content__backdrop");
  });

  it("uses a grouped bottom drawer instead of a long navigation menu", () => {
    const bottomNav = readPortalFile("apps/portal/components/layout/BottomNav.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");

    expect(bottomNav).toContain("<Drawer");
    expect(bottomNav).toContain("groupBottomNavItems");
    expect(bottomNav).toContain('swipeDirection="down"');
    expect(bottomNav).toContain('<DrawerContent id="bottom-nav-more-drawer"');
    expect(bottomNav).not.toContain("<Menu");
    expect(appShellCss).toContain("bottom-nav-drawer__group-title");
    expect(appShellCss).toContain("env(safe-area-inset-bottom)");
  });

  it("renders unknown routes in the focused status frame", () => {
    const appShell = readPortalFile("apps/portal/components/layout/AppShell.tsx");

    expect(appShell).toContain('activeRoute.to === "/__not-found__"');
  });

  it("keeps collapsed navigation branded until hover or keyboard focus reveals expand", () => {
    const appSidebar = readPortalFile("apps/portal/components/layout/AppSidebar.tsx");
    const appShellCss = readPortalFile("apps/portal/components/layout/AppShell.css");

    expect(appSidebar).toContain('className="app-brand-mark__identity"');
    expect(appSidebar).toContain('className="app-brand-mark__expand-icon"');
    expect(appSidebar).toContain("<RightOutlined size={18} />");
    expect(appSidebar).toContain("<LeftOutlined size={18} />");
    expect(appSidebar).toContain("<Icon size={18} />");
    expect(appShellCss).toContain(".app-brand-mark--button:hover .app-brand-mark__expand-icon");
    expect(appShellCss).toContain(".app-brand-mark--button:focus-visible .app-brand-mark__expand-icon");
  });
});
