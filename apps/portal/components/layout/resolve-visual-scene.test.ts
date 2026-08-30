import { describe, expect, it } from "vitest";
import { resolveVisualPageScene } from "./resolve-visual-scene";

const baseContext = {
  pathname: "/dashboard",
  searchStr: "",
  adminTab: "member" as const,
  isExternalView: false,
};

describe("resolveVisualPageScene", () => {
  it("uses the registered scene unless a route family selects a specific one", () => {
    expect(resolveVisualPageScene({ ...baseContext, baseScene: "dashboard" })).toBe("dashboard");
    expect(resolveVisualPageScene({ ...baseContext, baseScene: undefined })).toBeUndefined();
    expect(resolveVisualPageScene({
      ...baseContext,
      baseScene: "events",
      pathname: "/events/recurring/template-1/edit",
    })).toBe("events-recurring");
  });

  it("maps guild-war and profile tabs to their distinct scenes", () => {
    expect(resolveVisualPageScene({
      ...baseContext,
      baseScene: "guild-war",
      pathname: "/guild-war",
      searchStr: "?tab=analytics",
    })).toBe("guild-war-analytics");
    expect(resolveVisualPageScene({
      ...baseContext,
      baseScene: "guild-war",
      pathname: "/guild-war",
      isExternalView: true,
    })).toBe("guild-war-history");
    expect(resolveVisualPageScene({
      ...baseContext,
      baseScene: "profile",
      pathname: "/profile",
      searchStr: "?tab=availability",
    })).toBe("profile-availability");
  });

  it.each([
    ["member", "admin"],
    ["invite", "admin-invite"],
    ["roles", "admin-roles"],
    ["classes", "admin-classes"],
    ["badges", "admin-badges"],
    ["siteConfig", "admin-site-config"],
    ["importantNotices", "admin-important-notices"],
    ["operations", "admin-operations"],
    ["diagnostics", "admin-diagnostics"],
    ["audit", "admin-audit"],
  ] as const)("maps the %s admin tab", (adminTab, scene) => {
    expect(resolveVisualPageScene({
      ...baseContext,
      baseScene: "admin",
      pathname: "/admin",
      adminTab,
    })).toBe(scene);
  });
});
