// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalFile(path: string): string {
  return readFileSync(resolve(process.cwd(), `apps/portal/${path}`), "utf8");
}

describe("public landing architecture", () => {
  it("keeps the guest entrance and member dashboard as different routes", () => {
    const router = readPortalFile("router.tsx");
    const shell = readPortalFile("components/layout/AppShell.tsx");

    expect(router).toContain("const homeRoute = createRoute({");
    expect(router).toContain('path: "/dashboard"');
    expect(router).toContain('redirect({ to: "/dashboard" })');
    expect(router).toContain("component: LandingRoutePage");
    expect(router).toContain("component: DashboardRoutePage");
    expect(shell).toContain('const isGuestLanding = pathname === "/" && !user');
    expect(shell.indexOf("if (isGuestLanding)")).toBeLessThan(shell.indexOf("if (hideNavigation)"));
  });

  it("is one image-led entrance with a single portal action", () => {
    const landing = readPortalFile("components/pages/LandingPage.tsx");

    expect(landing).toContain("<VisualThemeScene");
    expect(landing).not.toContain("VisualThemeCharacter");
    expect(landing).toContain("<PublicSiteHeader showNavigation={false} />");
    expect(landing).toContain('to="/dashboard"');
    expect(landing).toContain('t("landing.motto")');
    expect(landing).not.toContain("ACTIVE_VISUAL_THEME_ID");
    expect(landing).not.toContain("siteDescription");
    expect(landing).not.toContain("accessNote");
    expect(landing).not.toContain("landing-hero__eyebrow");
    expect(landing).not.toContain("fetchDashboard");
    expect(landing).not.toContain("fetchAnnouncements");
    expect(landing).not.toContain('to="/events"');
    expect(landing).not.toContain('to="/announcements"');
  });

  it("uses a full-width public header instead of a centered strip", () => {
    const headerStyles = readPortalFile("components/layout/PublicSiteHeader.css");

    expect(headerStyles).toMatch(/\.public-site-header\s*\{[^}]*width:\s*100%/s);
    expect(headerStyles).not.toContain("width: min(100%, 1680px)");
  });
});
