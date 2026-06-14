import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routerSource(): string {
  return readFileSync(resolve(process.cwd(), "apps/portal/router.tsx"), "utf8").replace(/\r\n/g, "\n");
}

describe("portal route access policy", () => {
  it("keeps private account and admin routes under the authenticated route branch", () => {
    const source = routerSource();

    const authenticatedRoutes = [
      "profileRoute",
      "adminRoute",
      "storageRoute",
    ];

    for (const route of authenticatedRoutes) {
      expect(source).toContain(`authenticatedOnlyRoute.addChildren([`);
      const authBlock = source.slice(source.indexOf("authenticatedOnlyRoute.addChildren(["));
      expect(authBlock).toContain(`${route},`);
    }
  });

  it("keeps read-only feature routes outside the authenticated branch", () => {
    const source = routerSource();

    const routeTreeBlock = source.slice(source.indexOf("const routeTree = rootRoute.addChildren(["));
    const authBranchStart = routeTreeBlock.indexOf("authenticatedOnlyRoute.addChildren([");
    const publicBlock = routeTreeBlock.slice(0, authBranchStart);

    const publicRoutes = [
      "dashboardRoute",
      "eventsRoute",
      "eventDetailRoute",
      "rosterRoute",
      "announcementsRoute",
      "guildWarRoute",
      "galleryRoute",
      "wikiRoute",
      "wikiSlugRoute",
    ];

    for (const route of publicRoutes) {
      expect(publicBlock).toContain(`${route},`);
    }
  });

  it("keeps utility and auth routes outside the authenticated branch", () => {
    const source = routerSource();

    expect(source).toContain("publicSettingsRoute,");
    expect(source).toContain("publicToolsRoute,");
    expect(source).toContain("loginRoute,");
    expect(source).toContain("registerRoute,");
  });
});
