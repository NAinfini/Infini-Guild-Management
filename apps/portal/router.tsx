import type {
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
import { fetchRoles } from "./api/queries/roles";
import { canAccessAdmin } from "./utils/permissions";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { Suspense, lazy, type ReactNode } from "react";
import { z } from "zod";
import { apiRequest } from "./api/client";
import { fetchEventDetail } from "./api/queries/events";
import { AppShell } from "./components/layout/AppShell";
import { useAuthStore } from "./stores/auth";
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

const LazyAdminPage = lazy(() => import("./components/pages/AdminPage").then((mod) => ({ default: mod.AdminPage })));
const LazyAnnouncementsPage = lazy(() =>
  import("./components/pages/AnnouncementsPage").then((mod) => ({ default: mod.AnnouncementsPage })),
);
const LazyDashboardPage = lazy(() =>
  import("./components/pages/DashboardPage").then((mod) => ({ default: mod.DashboardPage })),
);
const LazyEventsPage = lazy(() => import("./components/pages/EventsPage").then((mod) => ({ default: mod.EventsPage })));
const LazyGalleryPage = lazy(() => import("./components/pages/GalleryPage").then((mod) => ({ default: mod.GalleryPage })));
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
  return <div style={{ minHeight: "60vh" }} />;
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
    return null;
  }
}

const rootRoute = createRootRoute({ component: AppShell });

const publicSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoutePage,
});

const publicToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
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

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardRoutePage,
});

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  validateSearch: (search) => EVENTS_ROUTE_SEARCH_SCHEMA.parse(search),
  component: EventsRoutePage,
});

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$id",
  beforeLoad: async ({ params }) => {
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
  component: AnnouncementsRoutePage,
});

const guildWarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guild-war",
  validateSearch: (search) => GUILD_WAR_SEARCH_SCHEMA.parse(search),
  component: GuildWarRoutePage,
});

const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gallery",
  component: GalleryRoutePage,
});

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki",
  component: WikiRoutePage,
});

const wikiSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki/$slug",
  component: WikiRoutePage,
});

const ADMIN_SEARCH_SCHEMA = z.object({
  member: z.string().optional(),
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

    const roles = await queryClient.fetchQuery({
      queryKey: ["admin", "roles"],
      queryFn: fetchRoles,
    });

    if (!canAccessAdmin(roles, user.role)) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminRoutePage,
});

const routeTree = rootRoute.addChildren([
  publicSettingsRoute,
  publicToolsRoute,
  loginRoute,
  registerRoute,
  dashboardRoute,
  eventsRoute,
  eventDetailRoute,
  rosterRoute,
  announcementsRoute,
  guildWarRoute,
  galleryRoute,
  wikiRoute,
  wikiSlugRoute,
  authenticatedOnlyRoute.addChildren([
    profileRoute,
    adminRoute,
  ]),
]);

const router = createRouter({ routeTree, defaultViewTransition: true });

router.subscribe("onBeforeLoad", () => nprogress.start());
router.subscribe("onResolved", () => nprogress.complete());

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProgress />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

