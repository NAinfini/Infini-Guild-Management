import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routerSource(): string {
  return readFileSync(resolve(process.cwd(), "apps/portal/router.tsx"), "utf8").replace(/\r\n/g, "\n");
}

describe("portal route access policy", () => {
  it("keeps all feature routes under the authenticated route branch", () => {
    const source = routerSource();

    const authenticatedRoutes = [
      "dashboardRoute",
      "eventsRoute",
      "eventDetailRoute",
      "rosterRoute",
      "announcementsRoute",
      "guildWarRoute",
      "galleryRoute",
      "wikiRoute",
      "wikiSlugRoute",
      "profileRoute",
      "adminRoute",
    ];

    for (const route of authenticatedRoutes) {
      expect(source).toContain(`authenticatedOnlyRoute.addChildren([`);
      const authBlock = source.slice(source.indexOf("authenticatedOnlyRoute.addChildren(["));
      expect(authBlock).toContain(`${route},`);
    }
  });

  it("keeps only public utility routes outside the authenticated branch", () => {
    const source = routerSource();

    expect(source).toContain("publicSettingsRoute,");
    expect(source).toContain("publicToolsRoute,");
    expect(source).toContain("loginRoute,");
    expect(source).toContain("registerRoute,");
  });
});
