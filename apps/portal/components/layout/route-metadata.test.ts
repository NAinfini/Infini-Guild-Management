import { describe, expect, it } from "vitest";
import {
  findPortalRoute,
  groupPortalRoutes,
  PORTAL_NAV_GROUPS,
  PORTAL_ROUTES,
} from "./route-metadata";

describe("portal route metadata", () => {
  it("keeps every destination unique and assigned to one layout contract", () => {
    const paths = PORTAL_ROUTES.map((route) => route.to);

    expect(new Set(paths).size).toBe(paths.length);
    expect(PORTAL_ROUTES.every((route) => route.contentWidth.length > 0)).toBe(true);
    expect(PORTAL_ROUTES.every((route) => PORTAL_NAV_GROUPS.some((group) => group.id === route.group))).toBe(true);
  });

  it("derives the stable mobile navigation from the same registry", () => {
    expect(
      PORTAL_ROUTES
        .filter((route) => route.mobilePrimary)
        .sort((left, right) => (left.mobilePrimary ?? 0) - (right.mobilePrimary ?? 0))
        .map((route) => route.to),
    ).toEqual(["/", "/events", "/guild-war", "/roster"]);
  });

  it("matches nested routes to their parent metadata", () => {
    expect(findPortalRoute("/events/event-1").to).toBe("/events");
    expect(findPortalRoute("/wiki/getting-started").to).toBe("/wiki");
    expect(findPortalRoute("/storage/manage").to).toBe("/storage");
  });

  it("uses the not-found title and reading width for unknown paths", () => {
    expect(findPortalRoute("/does-not-exist")).toMatchObject({
      labelKey: "notFound.title",
      contentWidth: "reading",
    });
  });

  it("keeps settings visible to guests in a standard-width workspace", () => {
    const settingsRoute = PORTAL_ROUTES.find((route) => route.to === "/settings");

    expect(settingsRoute).toMatchObject({
      contentWidth: "standard",
    });
    expect(settingsRoute?.requiresSession).not.toBe(true);
  });

  it("preserves the approved navigation hierarchy without empty groups", () => {
    const groups = groupPortalRoutes(PORTAL_ROUTES);

    expect(groups.map((group) => group.id)).toEqual([
      "overview",
      "community",
      "operations",
      "personal",
      "administration",
    ]);
    expect(groups.every((group) => group.routes.length > 0)).toBe(true);
  });
});
