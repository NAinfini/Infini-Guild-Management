import { type PushMessage } from "@guild/shared";
import type { PushEntityType } from "@guild/shared/constants/push-hints";
import { Alert, AppShell as MantineAppShell } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { setI18nLocale } from "../../i18n";
import { canAccessAdmin, userCanAccessAdmin } from "../../utils/permissions";
import { ViewingAsProvider } from "../../context/ViewingAsContext";
import { useNotificationPresentation } from "../../hooks/useNotificationPresentation";
import { useNotificationSync } from "../../hooks/useNotificationSync";
import { queryKeys } from "../../api/query-keys";
import { logout as requestLogout } from "../../services/AuthService";
import { fetchRoles } from "../../services/AdminService";
import { useAuthStore } from "../../stores/auth";
import { useNotificationStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useSiteConfigStore } from "../../stores/site-config";
import {
  installSessionSynchronization,
  revalidateSessionSnapshot,
  transitionSession,
} from "../../session-transition";
import { isExternalViewSearch } from "../../utils/external-view";
import { AppErrorOverlay } from "../shared/AppErrorOverlay";
import { OverlayRegistrar } from "../shared/OverlayRegistrar";
import { BottomNav } from "./BottomNav";
import {
  AppSidebar,
  SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  MOBILE_BREAKPOINT_PX,
  COMPACT_NAV_BREAKPOINT_PX,
  HEADER_COMPACT_BREAKPOINT_PX,
} from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import {
  findPortalRoute,
  PORTAL_ROUTES,
  type PortalRouteMetadata,
} from "./route-metadata";
import "./AppShell.css";

const ENTITY_QUERY_KEYS = {
  announcement: [queryKeys.announcements.all],
  event: [queryKeys.events.all, queryKeys.dashboard.all, queryKeys.guildWar.events()],
  wiki: [queryKeys.wiki.all],
  gallery: [queryKeys.gallery.all],
  storage: [queryKeys.storage.all],
  guild_war: [queryKeys.guildWar.all],
  member_profile: [queryKeys.users.all, queryKeys.myProfile.all],
  member_badge: [queryKeys.users.all, queryKeys.myProfile.all],
} satisfies Record<PushEntityType, readonly (readonly string[])[]>;

function normalizeViewingAs(role: string | null, isExternalView: boolean): string {
  if (isExternalView) {
    return "external";
  }
  return role ?? "external";
}

function syncViewSearch(nextRole: string) {
  const url = new URL(window.location.href);
  if (nextRole === "external") {
    url.searchParams.set("view", "external");
  } else {
    url.searchParams.delete("view");
  }
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AppShell() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const isExternalView = isExternalViewSearch(searchStr);
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`) ?? false;
  const usesCompactNavigation = useMediaQuery(`(max-width: ${COMPACT_NAV_BREAKPOINT_PX}px)`) ?? false;
  const isHeaderCompact = useMediaQuery(`(max-width: ${HEADER_COMPACT_BREAKPOINT_PX}px)`) ?? false;
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const isSidebarCollapsed = !isSidebarExpanded;
  const sidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  // `/register` (invite code entry) and `/register/<code>` are both full-screen
  // auth pages; neither may render inside the portal chrome.
  const hideNavigation = pathname === "/login" || pathname === "/register" || pathname.startsWith("/register/");
  const queryClient = useQueryClient();

  const user = useAuthStore((s) => s.user);
  const locale = usePreferencesStore((s) => s.locale);
  const notificationFeatures = useNotificationStore((state) => state.features);
  const pushEntries = useNotificationStore((state) => state.pushHistory);
  const { markFeatureAsRead, markPushAsRead, markAllPushAsRead, clearPushHistory } = useNotificationStore.getState();
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [permissionBanner, setPermissionBanner] = useState<string | null>(null);
  const [viewingAs, setViewingAs] = useState<string>(() =>
    normalizeViewingAs(user?.role ?? null, isExternalView),
  );
  const scrollContainerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void setI18nLocale(locale);
  }, [locale]);

  useEffect(() => {
    setViewingAs(normalizeViewingAs(user?.role ?? null, isExternalView));
  }, [isExternalView, user?.role]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const hadSession = Boolean(useAuthStore.getState().user);
      if (!hadSession) return;

      const detail = (event as CustomEvent<{ returnTo?: string }>).detail;
      const returnTo =
        detail?.returnTo && detail.returnTo.startsWith("/")
          ? detail.returnTo
          : `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (window.location.pathname === "/login") {
        return;
      }
      transitionSession(queryClient, null);
      void navigate({
        to: "/login",
        search: {
          reason: "expired",
          returnTo,
        },
      });
    };

    const onForbidden = () => {
      setPermissionBanner(t("nav.permissionDenied"));
    };

    window.addEventListener("guild-api-unauthorized", onUnauthorized as EventListener);
    window.addEventListener("guild-api-forbidden", onForbidden as EventListener);
    return () => {
      window.removeEventListener("guild-api-unauthorized", onUnauthorized as EventListener);
      window.removeEventListener("guild-api-forbidden", onForbidden as EventListener);
    };
  }, [navigate, queryClient, t]);

  useEffect(() => installSessionSynchronization({
    queryClient,
    onSessionChange: (session) => {
      if (!session && window.location.pathname !== "/login") {
        void navigate({ to: "/login", search: { reason: "expired" } });
      }
    },
  }), [navigate, queryClient]);

  const sessionRevalidationRef = useRef<Promise<unknown> | null>(null);
  const revalidateSession = useCallback(() => {
    if (!useAuthStore.getState().user || sessionRevalidationRef.current) return;
    const request = revalidateSessionSnapshot(queryClient)
      .catch((error: unknown) => {
        if (import.meta.env.DEV) console.error("[auth] Session revalidation failed", error);
      })
      .finally(() => {
        sessionRevalidationRef.current = null;
      });
    sessionRevalidationRef.current = request;
  }, [queryClient]);

  useEffect(() => {
    revalidateSession();
    window.addEventListener("focus", revalidateSession);
    return () => window.removeEventListener("focus", revalidateSession);
  }, [revalidateSession, user?.id]);

  const handlePushMessage = useCallback(
    (message: PushMessage) => {
      if (message.type === "entity_changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.cmdk.all });
        const keys = ENTITY_QUERY_KEYS[message.entity_type];
        if (keys) {
          for (const key of keys) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }
      }
      if (message.type === "announcement_published") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      }
    },
    [queryClient],
  );

  useNotificationSync({
    enabled: Boolean(user),
    onMessage: handlePushMessage,
  });
  useNotificationPresentation({
    enabled: Boolean(user),
    showToast: true,
  });

  const logoutMutation = useMutation({
    mutationFn: requestLogout,
    onSettled: () => {
      transitionSession(queryClient, null);
      void navigate({ to: "/login" });
    },
  });

  const logout = () => {
    logoutMutation.mutate();
  };

  const canSwitchView = user?.permissions["admin.roles.view"] === true
    || user?.permissions["admin.roles.manage"] === true;

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: canSwitchView,
    staleTime: Infinity,
  });

  const features = useSiteConfigStore((s) => s.features);

  const visibleNavItems = useMemo(
    () =>
      PORTAL_ROUTES.filter((item) => {
        if (item.featureFlag && !features[item.featureFlag]) {
          return false;
        }
        if (isExternalView && (item.to === "/profile" || item.to === "/admin")) {
          return false;
        }
        if (item.requiresSession && !user) {
          return false;
        }
        if (item.requiresModerator) {
          if (viewingAs === user?.role) {
            return userCanAccessAdmin(user);
          }
          const roles = rolesQuery.data ?? [];
          return canAccessAdmin(roles, viewingAs);
        }
        return true;
      }),
    [isExternalView, user, viewingAs, rolesQuery.data, features],
  );

  const mobileMainItems = useMemo(
    () =>
      visibleNavItems
        .filter((item) => item.mobilePrimary)
        .sort((left, right) => (left.mobilePrimary ?? 0) - (right.mobilePrimary ?? 0)),
    [visibleNavItems],
  );
  const mobileMoreItems = useMemo(
    () => visibleNavItems.filter((item) => !item.mobilePrimary),
    [visibleNavItems],
  );

  const notificationState = useMemo(
    () => ({
      announcements: notificationFeatures.announcements.hasNew,
      members: notificationFeatures.members.hasNew,
    }),
    [notificationFeatures.announcements.hasNew, notificationFeatures.members.hasNew],
  );

  const navHasNew = useCallback(
    (item: PortalRouteMetadata) =>
      item.feature === "announcements"
        ? notificationState.announcements
        : item.feature === "members"
          ? notificationState.members
          : false,
    [notificationState],
  );

  const markFeatureAsReadForPath = useCallback(
    (to: string) => {
      if (to === "/announcements") {
        markFeatureAsRead("announcements");
      }
      if (to === "/roster") {
        markFeatureAsRead("members");
      }
    },
    [markFeatureAsRead],
  );

  const displayPushEntries = pushEntries;

  const pushHasUnread = useMemo(
    () => displayPushEntries.some((entry) => entry.readAt === null),
    [displayPushEntries],
  );

  const handlePushNotificationClick = useCallback(
    (entryId: string, type: string) => {
      markPushAsRead(entryId);

      if (type === "announcement_published" || type === "announcement_created") {
        markFeatureAsRead("announcements");
        void navigate({ to: "/announcements" });
        return;
      }

      if (type === "event_created") {
        void navigate({ to: "/events" });
        return;
      }

      if (type === "wiki_created") {
        void navigate({ to: "/wiki" });
        return;
      }

      if (type === "member_joined") {
        markFeatureAsRead("members");
        void navigate({ to: "/roster" });
        return;
      }
    },
    [markFeatureAsRead, markPushAsRead, navigate],
  );

  const activeRoute = useMemo(() => findPortalRoute(pathname), [pathname]);
  const selectedNavKey = activeRoute.to;
  const activePageTitle = t(activeRoute.labelKey);

  if (hideNavigation) {
    return (
      <ViewingAsProvider value={viewingAs}>
        <div className="app-login-layout">
          <main className="app-login-content">
            <div className="app-login-panel">
              <Outlet />
            </div>
          </main>
        </div>
      </ViewingAsProvider>
    );
  }

  return (
    <ViewingAsProvider value={viewingAs}>
      <a href="#main-content" className="app-skip-link">{t("nav.skipToContent", "Skip to content")}</a>
      <MantineAppShell
        className="app-shell-root"
        layout="alt"
        header={{ height: 48 }}
        navbar={!usesCompactNavigation ? { width: sidebarWidth, breakpoint: COMPACT_NAV_BREAKPOINT_PX } : undefined}
        padding={0}
      >
        <OverlayRegistrar />
        <AppErrorOverlay />

        {!usesCompactNavigation ? (
          <AppSidebar
            isSidebarCollapsed={isSidebarCollapsed}
            onCollapse={() => setIsSidebarExpanded(false)}
            onExpand={() => setIsSidebarExpanded(true)}
            visibleNavItems={visibleNavItems}
            selectedNavKey={selectedNavKey}
            navHasNew={navHasNew}
            onNavigate={(to) => {
              markFeatureAsReadForPath(to);
              void navigate({ to: to as never });
            }}
            canSwitchView={canSwitchView}
            viewingAs={viewingAs}
            roles={rolesQuery.data ?? []}
            onViewingAsChange={(nextRole) => {
              setViewingAs(nextRole);
              syncViewSearch(nextRole);
            }}
          />
        ) : null}

        <AppHeader
          isMobile={isMobile}
          isHeaderCompact={isHeaderCompact}
          activePageTitle={activePageTitle}
          user={user}
          pushHasUnread={pushHasUnread}
          notificationAnnouncementsHasNew={notificationFeatures.announcements.hasNew}
          displayPushEntries={displayPushEntries}
          onNotificationClose={() => { markAllPushAsRead(); markFeatureAsRead("announcements"); }}
          onClearPushHistory={() => clearPushHistory()}
          onPushEntryClick={handlePushNotificationClick}
          onLogout={logout}
          onLoginClick={() => void navigate({ to: "/login" })}
        />

        <MantineAppShell.Main id="main-content" ref={scrollContainerRef} className={`app-content ${usesCompactNavigation ? "app-content-mobile" : ""}`}>
          <div className="app-main">
            {isExternalView ? (
              <Alert color="gray" variant="light" className="app-banner">
                {t("nav.externalViewBanner")}
              </Alert>
            ) : null}
            {!isOnline ? (
              <Alert color="orange" variant="light" className="app-banner" role="status" aria-live="polite">
                {t("nav.offlineBanner")}
              </Alert>
            ) : null}
            {permissionBanner ? (
              <Alert
                color="red"
                variant="light"
                className="app-banner"
                role="status"
                aria-live="polite"
                withCloseButton
                onClose={() => setPermissionBanner(null)}
              >
                {permissionBanner}
              </Alert>
            ) : null}
            <div className="app-route-container" data-content-width={activeRoute.contentWidth}>
              <Outlet />
            </div>
          </div>
        </MantineAppShell.Main>

        {usesCompactNavigation ? (
          <BottomNav
            pathname={pathname}
            mainItems={mobileMainItems.map((item) => ({
              to: item.to,
              label: t(item.labelKey),
              icon: item.icon,
              isNew: navHasNew(item),
            }))}
            moreItems={mobileMoreItems.map((item) => ({
              to: item.to,
              label: t(item.labelKey),
              icon: item.icon,
              isNew: navHasNew(item),
            }))}
            onNavigate={markFeatureAsReadForPath}
          />
        ) : null}
      </MantineAppShell>
    </ViewingAsProvider>
  );
}
