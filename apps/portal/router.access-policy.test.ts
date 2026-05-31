import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routerSource(): string {
  return readFileSync(resolve(process.cwd(), "apps/portal/router.tsx"), "utf8").replace(/\r\n/g, "\n");
}

describe("portal route access policy", () => {
  it("keeps profile and admin under the authenticated route branch", () => {
    const source = routerSource();

    expect(source).toContain("authenticatedOnlyRoute.addChildren([\n    profileRoute,\n    adminRoute,");
  });

  it("documents public read-only feature routes outside the authenticated branch", () => {
    const source = routerSource();

    expect(source).toContain("dashboardRoute,");
    expect(source).toContain("eventsRoute,");
    expect(source).toContain("rosterRoute,");
    expect(source).toContain("announcementsRoute,");
    expect(source).toContain("guildWarRoute,");
    expect(source).toContain("galleryRoute,");
    expect(source).toContain("wikiRoute,");
  });
});
