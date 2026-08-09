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
      "storageManageRoute",
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

  it("guards storage structure management with the structure permission", () => {
    const source = routerSource();
    const manageRoute = source.slice(
      source.indexOf("const storageManageRoute"),
      source.indexOf("const wikiRoute"),
    );

    expect(manageRoute).toContain('path: "/storage/manage"');
    expect(manageRoute).toContain('"admin.storage.structure"');
    expect(manageRoute).toContain('throw redirect({ to: "/storage" })');
  });

  it("accepts the current profile subpages in route search", () => {
    const source = routerSource();
    const profileSearchSchema = source.slice(
      source.indexOf("const PROFILE_SEARCH_SCHEMA"),
      source.indexOf("const ANNOUNCEMENTS_SEARCH_SCHEMA"),
    );

    expect(profileSearchSchema).toContain(
      'z.enum(["availability", "account"])',
    );
  });
});
