import type {
  FeatureFlags,
  MemberProfile,
  User,
} from "@guild/shared";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { userCanAccessAdmin } from "./utils/permissions";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { apiRequest } from "./api/client";
import { fetchEventDetail } from "./api/queries/events";
import { AppShell } from "./components/layout/AppShell";
import { useAuthStore } from "./stores/auth";
import { useSiteConfigStore } from "./stores/site-config";
import { buildEventWorkbenchSearch, EVENTS_ROUTE_SEARCH_SCHEMA, sanitizeEventsRouteSearch } from "./utils/event-navigation";
import { isExternalViewSearch } from "./utils/external-view";

type AuthSessionResponse = { user: User; profile: MemberProfile };

const LOGIN_SEARCH_SCHEMA = z.object({
  returnTo: z.string().optional(),
  reason: z.enum(["required", "expired"]).optional(),
});

const GUILD_WAR_SEARCH_SCHEMA = z.object({
  tab: z.enum(["active", "history", "analytics"]).optional(),
  warName: z.string().optional(),
});

const PROFILE_SEARCH_SCHEMA = z.object({
  tab: z.enum(["profile", "availability", "account"]).optional(),
});

const STORAGE_SEARCH_SCHEMA = z.object({
  storageId: z.string().trim().min(1).optional(),
});

const STORAGE_MANAGE_SEARCH_SCHEMA = STORAGE_SEARCH_SCHEMA.extend({
  categoryId: z.string().trim().min(1).optional(),
});

export function isRouteFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const features = useSiteConfigStore.getState().features;
  if (feature === "equipmentCalc") return features.tools && features.equipmentCalc;
  return features[feature];
}

function requireRouteFeature(feature: keyof FeatureFlags): void {
  if (!isRouteFeatureEnabled(feature)) {
    throw redirect({ to: "/" });
  }
}

const LazyAdminPage = lazy(() => import("./components/pages/AdminPage").then((mod) => ({ default: mod.AdminPage })));
const LazyAnnouncementsPage = lazy(() =>
  import("./components/pages/AnnouncementsPage").then((mod) => ({ default: mod.AnnouncementsPage })),
);
const LazyDashboardPage = lazy(() =>
  import("./components/pages/DashboardPage").then((mod) => ({ default: mod.DashboardPage })),
);
const LazyEventsPage = lazy(() => import("./components/pages/EventsPage").then((mod) => ({ default: mod.EventsPage })));
const LazyGalleryPage = lazy(() => import("./components/pages/GalleryPage").then((mod) => ({ default: mod.GalleryPage })));
const LazyStoragePage = lazy(() => import("./components/pages/StoragePage").then((mod) => ({ default: mod.StoragePage })));
const LazyStorageManagePage = lazy(() =>
  import("./components/pages/StorageManagePage").then((mod) => ({ default: mod.StorageManagePage })),
);
const LazyGuildWarPage = lazy(() =>
  import("./components/pages/GuildWarPage").then((mod) => ({ default: mod.GuildWarPage })),
);
const LazyMyProfilePage = lazy(() =>
  import("./components/pages/MyProfilePage").then((mod) => ({ default: mod.MyProfilePage })),
);
const LazyLoginPage = lazy(() => import("./components/pages/LoginPage").then((mod) => ({ default: mod.LoginPage })));
const LazyRegisterPage = lazy(() =>
  import("./components/pages/RegisterPage").then((mod) => ({ default: mod.RegisterPage })),
);
const LazySettingsPage = lazy(() =>
  import("./components/pages/SettingsPage").then((mod) => ({ default: mod.SettingsPage })),
);
const LazyToolsPage = lazy(() => import("./components/pages/ToolsPage").then((mod) => ({ default: mod.ToolsPage })));
const LazyWikiPage = lazy(() => import("./components/pages/WikiPage").then((mod) => ({ default: mod.WikiPage })));
const LazyRosterPage = lazy(() =>
  import("./components/pages/RosterPage").then((mod) => ({ default: mod.RosterPage })),
);

function RouteLoadingFallback(): ReactNode {
  const { t } = useTranslation("common");

  return (
    <div className="route-loading" role="status" aria-live="polite">
      <div className="route-loading__card">
        <div className="route-loading__spinner" aria-hidden="true" />
        <span className="route-loading__label">{t("message.loading")}</span>
      </div>
    </div>
  );
}

function DashboardRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyDashboardPage />
    </Suspense>
  );
}

function AnnouncementsRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyAnnouncementsPage />
    </Suspense>
  );
}

function EventsRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyEventsPage />
    </Suspense>
  );
}

function GuildWarRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyGuildWarPage />
    </Suspense>
  );
}

function GalleryRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyGalleryPage />
    </Suspense>
  );
}

function StorageRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyStoragePage />
    </Suspense>
  );
}

function StorageManageRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyStorageManagePage />
    </Suspense>
  );
}

function WikiRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyWikiPage />
    </Suspense>
  );
}

function MyProfileRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyMyProfilePage />
    </Suspense>
  );
}

function ToolsRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyToolsPage />
    </Suspense>
  );
}

function RosterRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyRosterPage />
    </Suspense>
  );
}

function AdminRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyAdminPage />
    </Suspense>
  );
}

function LoginRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyLoginPage />
    </Suspense>
  );
}

function RegisterRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyRegisterPage />
    </Suspense>
  );
}

function SettingsRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazySettingsPage />
    </Suspense>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

async function ensureSession(): Promise<AuthSessionResponse | null> {
  const store = useAuthStore.getState();
  if (store.user && store.profile) {
    return { user: store.user, profile: store.profile };
  }

  try {
    const response = await apiRequest<AuthSessionResponse>("/api/auth/me");
    useAuthStore.getState().setSession(response.user, response.profile);
    return response;
  } catch {
    useAuthStore.getState().clearSession();
    queryClient.clear();
    return null;
  }
}

function NotFoundPage(): ReactNode {
  const { t } = useTranslation("common");

  useEffect(() => {
    document.title = `404 - ${t("notFound.title")}`;
  }, [t]);

  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
      <span style={{ fontSize: 48, fontWeight: 700, opacity: 0.5 }}>404</span>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{t("notFound.title")}</span>
      <a href="/" className="not-found-page__link" style={{ fontSize: 14 }}>{t("notFound.backHome")}</a>
    </div>
  );
}

function RouteErrorFallback(): ReactNode {
  const { t } = useTranslation("common");
  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
      {/* This is the headline of the error screen, not decoration — the old 0.15
          opacity rendered it at 1.3:1. */}
      <span className="route-error__headline">{t("errors.somethingWentWrong")}</span>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{t("errors.generic")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="route-error__reload-button"
      >
        {t("action.reloadPage")}
      </button>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorFallback,
  beforeLoad: async () => {
    if (!useAuthStore.getState().user) {
      try {
        const response = await apiRequest<AuthSessionResponse>("/api/auth/me");
        useAuthStore.getState().setSession(response.user, response.profile);
      } catch {
        // no valid session — that's fine for public routes
      }
    }
  },
});

const publicSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoutePage,
});

const publicToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  beforeLoad: () => requireRouteFeature("tools"),
  component: ToolsRoutePage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search) => LOGIN_SEARCH_SCHEMA.parse(search),
  component: LoginRoutePage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register/$inviteCode",
  component: RegisterRoutePage,
});

// Same page without a code in the URL: it asks for the invite code first. This
// is where the login page's register link points, so the code is typed on a
// full registration page instead of inside the login card.
const registerEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterRoutePage,
});

const authenticatedOnlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: async ({ location }) => {
    const hadCachedSession = Boolean(useAuthStore.getState().user);
    const session = await ensureSession();
    if (!session) {
      const nextLocation = location as { pathname: string; searchStr?: string; hash?: string };
      throw redirect({
        to: "/login",
        search: {
          returnTo: `${nextLocation.pathname}${nextLocation.searchStr ?? ""}${nextLocation.hash ?? ""}`,
          reason: hadCachedSession ? "expired" : "required",
        },
      });
    }
  },
  component: Outlet,
});

// Guest users may browse public site content. Put read-only feature routes
// on rootRoute; keep user, moderator, and admin-only pages under
// authenticatedOnlyRoute.
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardRoutePage,
});

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  beforeLoad: () => requireRouteFeature("events"),
  validateSearch: (search) => EVENTS_ROUTE_SEARCH_SCHEMA.parse(search),
  component: EventsRoutePage,
});

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$id",
  beforeLoad: async ({ params }) => {
    requireRouteFeature("events");
    let detailTitle: string | undefined;
    try {
      const detail = await fetchEventDetail(params.id);
      detailTitle = detail.title;
    } catch {
      detailTitle = undefined;
    }

    throw redirect({
      to: "/events",
      search: sanitizeEventsRouteSearch(
        detailTitle
          ? buildEventWorkbenchSearch({ id: params.id, title: detailTitle })
          : { eventId: params.id, view: "cards" },
      ),
    });
  },
  component: Outlet,
});

const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roster",
  component: RosterRoutePage,
});

const profileRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/profile",
  validateSearch: (search) => PROFILE_SEARCH_SCHEMA.parse(search),
  beforeLoad: ({ location }) => {
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
      throw redirect({ to: "/" });
    }
  },
  component: MyProfileRoutePage,
});

const announcementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/announcements",
  beforeLoad: () => requireRouteFeature("announcements"),
  component: AnnouncementsRoutePage,
});

const guildWarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guild-war",
  beforeLoad: () => requireRouteFeature("guildWar"),
  validateSearch: (search) => GUILD_WAR_SEARCH_SCHEMA.parse(search),
  component: GuildWarRoutePage,
});

const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gallery",
  beforeLoad: () => requireRouteFeature("gallery"),
  component: GalleryRoutePage,
});

const storageRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/storage",
  validateSearch: (search) => STORAGE_SEARCH_SCHEMA.parse(search),
  beforeLoad: () => requireRouteFeature("storage"),
  component: StorageRoutePage,
});

const storageManageRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/storage/manage",
  validateSearch: (search) => STORAGE_MANAGE_SEARCH_SCHEMA.parse(search),
  beforeLoad: () => {
    requireRouteFeature("storage");
    const user = useAuthStore.getState().user;
    if (
      !user?.permissions["admin.storage.structure"]
      && !user?.permissions["admin.storage.manage"]
    ) {
      throw redirect({ to: "/storage" });
    }
  },
  component: StorageManageRoutePage,
});

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki",
  beforeLoad: () => requireRouteFeature("wiki"),
  component: WikiRoutePage,
});

const wikiSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki/$slug",
  beforeLoad: () => requireRouteFeature("wiki"),
  component: WikiRoutePage,
});

const ADMIN_SEARCH_SCHEMA = z.object({
  member: z.string().optional(),
  tab: z.enum(["member", "invite", "audit", "roles", "siteConfig", "badges", "status", "gameData"]).optional(),
});

const adminRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/admin",
  validateSearch: (search) => ADMIN_SEARCH_SCHEMA.parse(search),
  beforeLoad: async ({ location }) => {
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
      throw redirect({ to: "/" });
    }

    const user = useAuthStore.getState().user;
    if (!user) {
      throw redirect({ to: "/" });
    }

    if (!userCanAccessAdmin(user)) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminRoutePage,
});

// Public browsing routes are listed before the authenticated branch so guests
// can view the website without being redirected to /login.
const routeTree = rootRoute.addChildren([
  dashboardRoute,
  eventsRoute,
  eventDetailRoute,
  rosterRoute,
  announcementsRoute,
  guildWarRoute,
  galleryRoute,
  wikiRoute,
  wikiSlugRoute,
  publicSettingsRoute,
  publicToolsRoute,
  loginRoute,
  registerRoute,
  registerEntryRoute,
  // User, moderator, and admin-only features stay locked behind session checks.
  authenticatedOnlyRoute.addChildren([
    storageRoute,
    storageManageRoute,
    profileRoute,
    adminRoute,
  ]),
]);

const router = createRouter({ routeTree, defaultViewTransition: false });

router.subscribe("onBeforeLoad", () => nprogress.start());
router.subscribe("onResolved", () => nprogress.complete());

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProgress aria-hidden="true" />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

