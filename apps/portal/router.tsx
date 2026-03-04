import type {
  MemberProfile,
  User,
} from "@guild/shared";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useParams,
} from "@tanstack/react-router";
import {
  Alert,
  Card,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Suspense, lazy } from "react";
import { z } from "zod";
import { apiRequest } from "./api/client";
import { queryKeys } from "./api/query-keys";
import { fetchEventDetail } from "./api/queries/events";
import { AppShell } from "./components/layout/AppShell";
import { useAuthStore } from "./stores/auth";
import { isExternalViewSearch } from "./utils/external-view";

type AuthSessionResponse = { user: User; profile: MemberProfile };

const LOGIN_SEARCH_SCHEMA = z.object({
  returnTo: z.string().optional(),
  reason: z.enum(["required", "expired"]).optional(),
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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function DashboardRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyDashboardPage />
    </Suspense>
  );
}

function AnnouncementsRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyAnnouncementsPage />
    </Suspense>
  );
}

function EventsRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyEventsPage />
    </Suspense>
  );
}

function GuildWarRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyGuildWarPage />
    </Suspense>
  );
}

function GalleryRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyGalleryPage />
    </Suspense>
  );
}

function WikiRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyWikiPage />
    </Suspense>
  );
}

function MyProfileRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyMyProfilePage />
    </Suspense>
  );
}

function ToolsRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyToolsPage />
    </Suspense>
  );
}

function RosterRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyRosterPage />
    </Suspense>
  );
}

function AdminRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyAdminPage />
    </Suspense>
  );
}

function LoginRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyLoginPage />
    </Suspense>
  );
}

function RegisterRoutePage() {
  return (
    <Suspense fallback={null}>
      <LazyRegisterPage />
    </Suspense>
  );
}

function SettingsRoutePage() {
  return (
    <Suspense fallback={null}>
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

function EventDetailPanel() {
  const params = useParams({ strict: false });
  const id = (params as { id: string }).id;

  const detailQuery = useQuery({
    queryKey: queryKeys.event.detail(id),
    queryFn: () => fetchEventDetail(id),
  });

  if (detailQuery.isLoading) {
    return null;
  }

  if (detailQuery.isError) {
    return <Alert color="yellow" variant="light">Unable to load data. Please try again later.</Alert>;
  }

  const detail = detailQuery.data;
  if (!detail) {
    return <Alert color="yellow" variant="light">Missing event</Alert>;
  }

  return (
    <Card withBorder>
      <Stack gap={8}>
        <Title order={3}>{detail.title}</Title>
        <Text>{detail.description ?? "-"}</Text>
        <Text>Participants: {detail.participants.length}</Text>
        {detail.attachments.length > 0 ? (
          <>
            <Text>Attachments: {detail.attachments.length}</Text>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {detail.attachments.map((attachment) =>
                isHttpUrl(attachment) ? (
                  <img
                    key={attachment}
                    src={attachment}
                    alt="Event attachment"
                    loading="lazy"
                    decoding="async"
                    style={{ width: "100%", maxHeight: 320, objectFit: "cover", borderRadius: 8 }}
                  />
                ) : (
                  <Text key={attachment} c="dimmed" style={{ wordBreak: "break-all" }}>
                    {attachment}
                  </Text>
                ),
              )}
            </div>
          </>
        ) : null}
      </Stack>
    </Card>
  );
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
  component: EventsRoutePage,
});

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$id",
  component: EventDetailPanel,
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

const adminRoute = createRoute({
  getParentRoute: () => authenticatedOnlyRoute,
  path: "/admin",
  beforeLoad: ({ location }) => {
    if (isExternalViewSearch((location as { searchStr?: string }).searchStr)) {
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

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}



