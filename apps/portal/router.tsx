import type {
  FeatureFlags,
  User,
} from "@guild/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  retainSearchParams,
  useRouter,
} from "@tanstack/react-router";
import { userCanAccessAdmin } from "./utils/permissions";
import { useEffect, type ReactNode } from "react";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { queryClient } from "./api/query-client";
import { AppShell } from "./components/layout/AppShell";
import { LoadingIndicator } from "./components/ui/loading-indicator";
import { SystemStatusPage } from "./components/pages/SystemStatusPage";
import { createRouteSessionResolver } from "./router-session";
import { getSessionSnapshot, resolveSessionSnapshot, type PortalSession } from "./session-transition";
import { useAuthStore } from "./stores/auth";
import { useSiteConfigStore } from "./stores/site-config";
import { EVENTS_ROUTE_SEARCH_SCHEMA } from "./utils/event-navigation";
import { isExternalViewSearch } from "./utils/external-view";
import { isSafeReturnTo, stashEmailVerificationToken } from "./utils/auth-navigation";
import {
  RouteProgress,
  completeRouteProgress,
  startRouteProgress,
} from "./components/ui/route-progress";

const routeSessionResolver = createRouteSessionResolver({
  getCachedSession: getSessionSnapshot,
  isSessionResolved: () => useAuthStore.getState().sessionResolved,
  markSessionResolved: () => useAuthStore.getState().markSessionResolved(),
  requestSession: () => resolveSessionSnapshot(queryClient, undefined, { broadcast: false }),
});

const PORTAL_PREVIEW_SEARCH_SCHEMA = z.object({
  preview: z.literal("external").optional(),
}).passthrough();

const LOGIN_SEARCH_SCHEMA = z.object({
  returnTo: z.string().optional(),
  reason: z.enum(["required", "expired"]).optional(),
  oauth: z.literal("failed").optional(),
});

const COMPLETE_PASSWORD_RESET_SEARCH_SCHEMA = z.object({
  returnTo: z.string().optional(),
});

const GUILD_WAR_SEARCH_SCHEMA = z.object({
  tab: z.enum(["active", "history", "analytics"]).optional(),
  /*
   * TanStack 默认的搜索参数解析会先拿 JSON.parse 试一遍，所以 ?warName=2026 到这里
   * 已经是 number 了，z.string() 会直接把整条路由打进错误边界。战名是用户随便填的，
   * 纯数字完全合法（仪表盘的「上一场战」卡片就照原样带过来）。
   * 用 coerce 收口：.optional() 会在 coerce 之前短路掉 undefined，不会变出 "undefined"。
   */
  warName: z.coerce.string().optional(),
});

const PROFILE_SEARCH_SCHEMA = z.object({
  tab: z.enum(["availability", "account"]).optional(),
  oauth: z.literal("linked").optional(),
});

const CONTENT_SEARCH_SCHEMA = z.object({}).passthrough();

const STORAGE_SEARCH_SCHEMA = z.object({
  storageId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
});

const STORAGE_MANAGE_SEARCH_SCHEMA = STORAGE_SEARCH_SCHEMA;

const EVENT_EDITOR_SEARCH_SCHEMA = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).passthrough();

export function isRouteFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const features = useSiteConfigStore.getState().features;
  return features[feature];
}

function requireRouteFeature(feature: keyof FeatureFlags): void {
  if (!isRouteFeatureEnabled(feature)) {
    throw redirect({ to: "/" });
  }
}

type AuthenticatedRouteLocation = {
  pathname: string;
  searchStr?: string;
  hash?: string;
};

async function requireAuthenticatedSession(
  location: AuthenticatedRouteLocation,
): Promise<PortalSession> {
  const hadCachedSession = Boolean(useAuthStore.getState().user);
  const session = await ensureSession();
  if (!session) {
    if (location.pathname === "/verify-email" && location.hash) {
      stashEmailVerificationToken(location.hash);
    }
    throw redirect({
      to: "/login",
      search: {
        returnTo: `${location.pathname}${location.searchStr ?? ""}`,
        reason: hadCachedSession ? "expired" : "required",
      },
    });
  }
  if (session.session_scope === "password_change" && location.pathname !== "/complete-password-reset") {
    const returnTo = `${location.pathname}${location.searchStr ?? ""}`;
    throw redirect({
      to: "/complete-password-reset",
      search: isSafeReturnTo(returnTo) ? { returnTo } : {},
    });
  }
  return session;
}

async function requireEventMutationPermission(
  permission: keyof User["permissions"],
  location: AuthenticatedRouteLocation,
): Promise<void> {
  return requireFeatureMutationPermission("events", permission, location);
}

async function requireFeatureMutationPermission(
  feature: keyof FeatureFlags,
  permission: keyof User["permissions"],
  location: AuthenticatedRouteLocation,
): Promise<void> {
  requireRouteFeature(feature);
  const session = await requireAuthenticatedSession(location);
  if (isExternalViewSearch(location.searchStr)) {
    throw redirect({ to: "/403" });
  }
  if (!session.user.permissions[permission]) {
    throw redirect({ to: "/403" });
  }
}

const LazyAdminPage = lazyRouteComponent(() => import("./components/pages/AdminPage").then((mod) => ({ default: mod.AdminPage })));
const LazyAnnouncementsPage = lazyRouteComponent(() =>
  import("./components/pages/AnnouncementsPage").then((mod) => ({ default: mod.AnnouncementsPage })),
);
const LazyDashboardPage = lazyRouteComponent(() =>
  import("./components/pages/DashboardPage").then((mod) => ({ default: mod.DashboardPage })),
);
const LazyLandingPage = lazyRouteComponent(() =>
  import("./components/pages/LandingPage").then((mod) => ({ default: mod.LandingPage })),
);
const LazyEventsPage = lazyRouteComponent(() => import("./components/pages/EventsPage").then((mod) => ({ default: mod.EventsPage })));
const LazyEventDetailPage = lazyRouteComponent(() =>
  import("./components/pages/EventDetailPage").then((mod) => ({ default: mod.EventDetailPage })),
);
const LazyEventEditorPage = lazyRouteComponent(() =>
  import("./components/pages/EventEditorPage").then((mod) => ({ default: mod.EventEditorPage })),
);
const LazyRecurringTemplatesPage = lazyRouteComponent(() =>
  import("./components/pages/RecurringTemplatesPage").then((mod) => ({ default: mod.RecurringTemplatesPage })),
);
const LazyRecurringTemplateEditorPage = lazyRouteComponent(() =>
  import("./components/pages/RecurringTemplateEditorPage").then((mod) => ({ default: mod.RecurringTemplateEditorPage })),
);
const LazyGalleryPage = lazyRouteComponent(() => import("./components/pages/GalleryPage").then((mod) => ({ default: mod.GalleryPage })));
const LazyStoragePage = lazyRouteComponent(() => import("./components/pages/StoragePage").then((mod) => ({ default: mod.StoragePage })));
const LazyStorageManagePage = lazyRouteComponent(() =>
  import("./components/pages/StorageManagePage").then((mod) => ({ default: mod.StorageManagePage })),
);
const LazyGuildWarPage = lazyRouteComponent(() =>
  import("./components/pages/GuildWarPage").then((mod) => ({ default: mod.GuildWarPage })),
);
const LazyMyProfilePage = lazyRouteComponent(() =>
  import("./components/pages/MyProfilePage").then((mod) => ({ default: mod.MyProfilePage })),
);
const LazyLoginPage = lazyRouteComponent(() => import("./components/pages/LoginPage").then((mod) => ({ default: mod.LoginPage })));
const LazyRegisterPage = lazyRouteComponent(() =>
  import("./components/pages/RegisterPage").then((mod) => ({ default: mod.RegisterPage })),
);
const LazyCompletePasswordResetPage = lazyRouteComponent(() =>
  import("./components/pages/CompletePasswordResetPage").then((mod) => ({ default: mod.CompletePasswordResetPage })),
);
const LazyVerifyEmailPage = lazyRouteComponent(() =>
  import("./components/pages/VerifyEmailPage").then((mod) => ({ default: mod.VerifyEmailPage })),
);
const LazySettingsPage = lazyRouteComponent(() =>
  import("./components/pages/SettingsPage").then((mod) => ({ default: mod.SettingsPage })),
);
const LazyToolsPage = lazyRouteComponent(() => import("./components/pages/ToolsPage").then((mod) => ({ default: mod.ToolsPage })));
const LazyWikiPage = lazyRouteComponent(() => import("./components/pages/WikiPage").then((mod) => ({ default: mod.WikiPage })));
const LazyRosterPage = lazyRouteComponent(() =>
  import("./components/pages/RosterPage").then((mod) => ({ default: mod.RosterPage })),
);

function EventCreateRoutePage() {
  return <LazyEventEditorPage mode="create" />;
}
EventCreateRoutePage.preload = () => LazyEventEditorPage.preload?.();

function EventEditRoutePage() {
  return <LazyEventEditorPage mode="edit" />;
}
EventEditRoutePage.preload = () => LazyEventEditorPage.preload?.();

function RecurringTemplateCreateRoutePage() {
  return <LazyRecurringTemplateEditorPage mode="create" />;
}
RecurringTemplateCreateRoutePage.preload = () => LazyRecurringTemplateEditorPage.preload?.();

function RecurringTemplateEditRoutePage() {
  return <LazyRecurringTemplateEditorPage mode="edit" />;
}
RecurringTemplateEditRoutePage.preload = () => LazyRecurringTemplateEditorPage.preload?.();

async function ensureSession(): Promise<PortalSession | null> {
  return routeSessionResolver.resolve();
}

function NotFoundPage(): ReactNode {
  const { t } = useTranslation("common");
  const title = t("notFound.title");

  useEffect(() => {
    document.title = `404 - ${title}`;
  }, [title]);

  return (
    <SystemStatusPage
      kind="not-found"
      code="404"
      title={title}
      description={t("notFound.description")}
      action={{ label: t("nav.returnToPortal"), href: "/" }}
    />
  );
}

function RouteErrorFallback(): ReactNode {
  const { t } = useTranslation("common");
  const router = useRouter();
  const title = t("errors.pageUnavailable.title");

  useEffect(() => {
    document.title = `500 - ${title}`;
  }, [title]);

  return (
    <SystemStatusPage
      kind="error"
      code="500"
      title={title}
      description={t("errors.pageUnavailable.description")}
      action={{ label: t("action.retry"), onClick: () => void router.invalidate() }}
    />
  );
}

function UnauthorizedPage(): ReactNode {
  const { t } = useTranslation("common");
  const title = t("unauthorized.title");

  useEffect(() => {
    document.title = `401 - ${title}`;
  }, [title]);

  return (
    <SystemStatusPage
      kind="unauthorized"
      code="401"
      title={title}
      description={t("unauthorized.description")}
      action={{ label: t("action.goToLogin"), href: "/login" }}
    />
  );
}

function ForbiddenPage(): ReactNode {
  const { t } = useTranslation("common");
  const title = t("forbidden.title");

  useEffect(() => {
    document.title = `403 - ${title}`;
  }, [title]);

  return (
    <SystemStatusPage
      kind="forbidden"
      code="403"
      title={title}
      description={t("forbidden.description")}
      action={{ label: t("nav.returnToPortal"), href: "/" }}
    />
  );
}

function MaintenancePage(): ReactNode {
  const { t } = useTranslation("common");
  const title = t("maintenance.title");

  useEffect(() => {
    document.title = `503 - ${title}`;
  }, [title]);

  return (
    <SystemStatusPage
      kind="maintenance"
      code="503"
      title={title}
      description={t("maintenance.description")}
      action={{ label: t("action.retry"), onClick: () => window.location.reload() }}
    />
  );
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorFallback,
  validateSearch: (search) => PORTAL_PREVIEW_SEARCH_SCHEMA.parse(search),
  search: {
    middlewares: [retainSearchParams<z.infer<typeof PORTAL_PREVIEW_SEARCH_SCHEMA>>(["preview"])],
  },
  beforeLoad: async () => {
    await ensureSession();
  },
});

const publicSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: LazySettingsPage,
});

const publicToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  beforeLoad: () => requireRouteFeature("tools"),
  component: LazyToolsPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search) => LOGIN_SEARCH_SCHEMA.parse(search),
  component: LazyLoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register/$inviteCode",
  component: LazyRegisterPage,
});

// Same page without a code in the URL: it asks for the invite code first. This
// is where the login page's register link points, so the code is typed on a
// full registration page instead of inside the login card.
const registerEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: LazyRegisterPage,
});

const unauthorizedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/401",
  component: UnauthorizedPage,
});

const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/403",
  component: ForbiddenPage,
});

const maintenanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/maintenance",
  component: MaintenancePage,
});

const authenticatedOnlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: ({ location }) => requireAuthenticatedSession(location),
  component: Outlet,
});

// Guest users may browse public site content. Put read-only feature routes
// on rootRoute; keep user, moderator, and admin-only pages under
// authenticatedOnlyRoute.
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    if (useAuthStore.getState().user) throw redirect({ to: "/dashboard" });
  },
  component: LazyLandingPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: LazyDashboardPage,
});

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  beforeLoad: () => requireRouteFeature("events"),
  validateSearch: (search) => EVENTS_ROUTE_SEARCH_SCHEMA.parse(search),
  component: LazyEventsPage,
});

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$id",
  beforeLoad: () => {
    requireRouteFeature("events");
  },
  component: LazyEventDetailPage,
});

const eventCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/new",
  validateSearch: (search) => EVENT_EDITOR_SEARCH_SCHEMA.parse(search),
  beforeLoad: ({ location }) => requireEventMutationPermission("events.create", location),
  component: EventCreateRoutePage,
});

const eventEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$id/edit",
  beforeLoad: ({ location }) => requireEventMutationPermission("events.edit", location),
  component: EventEditRoutePage,
});

const recurringTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/recurring",
  beforeLoad: ({ location }) => requireEventMutationPermission("events.templates", location),
  component: LazyRecurringTemplatesPage,
});

const recurringTemplateCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/recurring/new",
  beforeLoad: ({ location }) => requireEventMutationPermission("events.templates", location),
  component: RecurringTemplateCreateRoutePage,
});

const recurringTemplateEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/recurring/$templateId/edit",
  beforeLoad: ({ location }) => requireEventMutationPermission("events.templates", location),
  component: RecurringTemplateEditRoutePage,
});

const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roster",
  component: LazyRosterPage,
});

const profileRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/profile",
  validateSearch: (search) => PROFILE_SEARCH_SCHEMA.parse(search),
  beforeLoad: ({ location }) => {
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
      throw redirect({ to: "/403" });
    }
  },
  component: LazyMyProfilePage,
});

const completePasswordResetRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/complete-password-reset",
  validateSearch: (search) => COMPLETE_PASSWORD_RESET_SEARCH_SCHEMA.parse(search),
  beforeLoad: async () => {
    const session = await ensureSession();
    if (!session || session.session_scope !== "password_change") throw redirect({ to: "/" });
  },
  component: LazyCompletePasswordResetPage,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/verify-email",
  beforeLoad: async () => {
    const session = await ensureSession();
    if (!session || session.session_scope !== "normal") throw redirect({ to: "/" });
  },
  component: LazyVerifyEmailPage,
});

const announcementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/announcements",
  beforeLoad: () => requireRouteFeature("announcements"),
  validateSearch: (search) => CONTENT_SEARCH_SCHEMA.parse(search),
  component: LazyAnnouncementsPage,
});

const announcementCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/announcements/new",
  beforeLoad: ({ location }) => requireFeatureMutationPermission(
    "announcements",
    "announcements.create",
    location,
  ),
  validateSearch: (search) => CONTENT_SEARCH_SCHEMA.parse(search),
  component: LazyAnnouncementsPage,
});

const announcementDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/announcements/$announcementId",
  beforeLoad: () => requireRouteFeature("announcements"),
  validateSearch: (search) => CONTENT_SEARCH_SCHEMA.parse(search),
  component: LazyAnnouncementsPage,
});

const guildWarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guild-war",
  beforeLoad: () => requireRouteFeature("guildWar"),
  validateSearch: (search) => GUILD_WAR_SEARCH_SCHEMA.parse(search),
  component: LazyGuildWarPage,
});

const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gallery",
  beforeLoad: () => requireRouteFeature("gallery"),
  component: LazyGalleryPage,
});

const storageRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/storage",
  validateSearch: (search) => STORAGE_SEARCH_SCHEMA.parse(search),
  beforeLoad: ({ location }) => {
    requireRouteFeature("storage");
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
      throw redirect({ to: "/403" });
    }
  },
  component: LazyStoragePage,
});

const storageManageRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/storage/manage",
  validateSearch: (search) => STORAGE_MANAGE_SEARCH_SCHEMA.parse(search),
  beforeLoad: ({ location }) => {
    requireRouteFeature("storage");
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
      throw redirect({ to: "/403" });
    }
    const user = useAuthStore.getState().user;
    if (!user?.permissions["admin.storage.structure"]) {
      throw redirect({ to: "/storage" });
    }
  },
  component: LazyStorageManagePage,
});

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki",
  beforeLoad: () => requireRouteFeature("wiki"),
  validateSearch: (search) => CONTENT_SEARCH_SCHEMA.parse(search),
  component: LazyWikiPage,
});

const wikiCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki/new",
  beforeLoad: ({ location }) => requireFeatureMutationPermission(
    "wiki",
    "wiki.articles.create",
    location,
  ),
  validateSearch: (search) => CONTENT_SEARCH_SCHEMA.parse(search),
  component: LazyWikiPage,
});

const wikiSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki/$slug",
  beforeLoad: () => requireRouteFeature("wiki"),
  validateSearch: (search) => CONTENT_SEARCH_SCHEMA.parse(search),
  component: LazyWikiPage,
});

const ADMIN_SEARCH_SCHEMA = z.object({
  member: z.string().optional(),
  tab: z.enum([
    "member",
    "invite",
    "roles",
    "importantNotices",
    "classes",
    "badges",
    "siteConfig",
    "operations",
    "diagnostics",
    "audit",
  ]).optional(),
});

const adminRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/admin",
  validateSearch: (search) => ADMIN_SEARCH_SCHEMA.parse(search),
  beforeLoad: async ({ location }) => {
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
      throw redirect({ to: "/403" });
    }

    const user = useAuthStore.getState().user;
    if (!user) {
      throw redirect({ to: "/403" });
    }

    if (!userCanAccessAdmin(user)) {
      throw redirect({ to: "/403" });
    }
  },
  component: LazyAdminPage,
});

// Public browsing routes are listed before the authenticated branch so guests
// can view the website without being redirected to /login.
const routeTree = rootRoute.addChildren([
  homeRoute,
  dashboardRoute,
  eventsRoute,
  eventDetailRoute,
  eventCreateRoute,
  eventEditRoute,
  recurringTemplatesRoute,
  recurringTemplateCreateRoute,
  recurringTemplateEditRoute,
  rosterRoute,
  announcementsRoute,
  announcementCreateRoute,
  announcementDetailRoute,
  guildWarRoute,
  galleryRoute,
  wikiRoute,
  wikiCreateRoute,
  wikiSlugRoute,
  publicSettingsRoute,
  publicToolsRoute,
  loginRoute,
  registerRoute,
  registerEntryRoute,
  unauthorizedRoute,
  forbiddenRoute,
  maintenanceRoute,
  // User, moderator, and admin-only features stay locked behind session checks.
  authenticatedOnlyRoute.addChildren([
    storageRoute,
    storageManageRoute,
    profileRoute,
    completePasswordResetRoute,
    verifyEmailRoute,
    adminRoute,
  ]),
]);

const router = createRouter({
  routeTree,
  defaultViewTransition: false,
  defaultPendingComponent: LoadingIndicator,
  // Keep the current route interactive until the target module is ready.
  defaultPendingMs: Infinity,
});

router.subscribe("onBeforeLoad", startRouteProgress);
router.subscribe("onResolved", completeRouteProgress);

export function AppRouter() {
  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.user !== previous.user || state.sessionScope !== previous.sessionScope) {
      void router.invalidate();
    }
  }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouteProgress />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

