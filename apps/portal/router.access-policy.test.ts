// @vitest-environment node
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
      "eventCreateRoute",
      "eventEditRoute",
      "recurringTemplatesRoute",
      "recurringTemplateCreateRoute",
      "recurringTemplateEditRoute",
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
    expect(source).toContain("forbiddenRoute,");
    expect(source).toContain("maintenanceRoute,");
  });

  it("guards mutable event routes by current-session permissions while keeping details public", () => {
    const source = routerSource();
    const detailRoute = source.slice(source.indexOf("const eventDetailRoute"), source.indexOf("const rosterRoute"));
    const mutationGuard = source.slice(
      source.indexOf("async function requireEventMutationPermission"),
      source.indexOf("const LazyAdminPage"),
    );

    expect(detailRoute).not.toContain("throw redirect({\n      to: \"/events\"");
    expect(detailRoute).not.toContain("fetchEventDetail(params.id)");
    expect(source).toContain('path: "/events/new"');
    expect(source).toContain('path: "/events/$id/edit"');
    expect(source).toContain('path: "/events/recurring/new"');
    expect(source).toContain('path: "/events/recurring/$templateId/edit"');
    expect(source).toContain('"events.create"');
    expect(source).toContain('"events.edit"');
    expect(source).toContain('"events.templates"');
    expect(mutationGuard).toContain("requireAuthenticatedSession(location)");
    expect(mutationGuard.indexOf("requireAuthenticatedSession(location)")).toBeLessThan(
      mutationGuard.indexOf("isExternalViewSearch"),
    );
    expect(source.match(/requireEventMutationPermission\("events\.(?:create|edit|templates)", location\)/g)).toHaveLength(5);
  });

  it("guards the announcement create route by session, external mode, and create permission", () => {
    const source = routerSource();
    const createRoute = source.slice(
      source.indexOf("const announcementCreateRoute"),
      source.indexOf("const announcementDetailRoute"),
    );
    const mutationGuard = source.slice(
      source.indexOf("async function requireFeatureMutationPermission"),
      source.indexOf("const LazyAdminPage"),
    );

    expect(createRoute).toContain('path: "/announcements/new"');
    expect(createRoute).toContain('"announcements.create"');
    expect(createRoute).toContain("requireFeatureMutationPermission");
    expect(mutationGuard).toContain("requireAuthenticatedSession(location)");
    expect(mutationGuard).toContain("isExternalViewSearch(location.searchStr)");
    expect(mutationGuard).toContain('throw redirect({ to: "/403" })');
  });

  it("guards the wiki create route by session, external mode, and create permission", () => {
    const source = routerSource();
    const createRoute = source.slice(
      source.indexOf("const wikiCreateRoute"),
      source.indexOf("const wikiSlugRoute"),
    );

    expect(createRoute).toContain('path: "/wiki/new"');
    expect(createRoute).toContain('"wiki.articles.create"');
    expect(createRoute).toContain("requireFeatureMutationPermission");
  });

  it("guards storage structure management from external preview and by structure permission", () => {
    const source = routerSource();
    const storageRoute = source.slice(
      source.indexOf("const storageRoute"),
      source.indexOf("const storageManageRoute"),
    );
    const manageRoute = source.slice(
      source.indexOf("const storageManageRoute"),
      source.indexOf("const wikiRoute"),
    );

    expect(storageRoute).toContain("isExternalViewSearch");
    expect(storageRoute).toContain('throw redirect({ to: "/403" })');
    expect(manageRoute).toContain('path: "/storage/manage"');
    expect(manageRoute).toContain("isExternalViewSearch");
    expect(manageRoute).toContain('throw redirect({ to: "/403" })');
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

  it("retries route errors without reloading the document", () => {
    const source = routerSource();
    const errorFallback = source.slice(
      source.indexOf("function RouteErrorFallback"),
      source.indexOf("function ForbiddenPage"),
    );

    expect(errorFallback).toContain("useRouter()");
    expect(errorFallback).toContain("router.invalidate()");
    expect(errorFallback).not.toContain("window.location.reload");
  });

  it("announces lazy route loading while the global route progress supplies visual feedback", () => {
    const source = routerSource();
    const loadingFallback = source.slice(
      source.indexOf("function RouteLoadingFallback"),
      source.indexOf("function LandingRoutePage"),
    );

    expect(loadingFallback).not.toContain("<Skeleton");
    expect(source).toContain("<RouteProgress />");
    expect(loadingFallback).toContain('role="status"');
    expect(loadingFallback).toContain('aria-live="polite"');
  });
});
