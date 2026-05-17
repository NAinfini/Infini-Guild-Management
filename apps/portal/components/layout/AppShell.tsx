import { type PushMessage } from "@guild/shared";
import { ScrollProgress } from "@portal/components/effects";
import { Alert, AppShell as MantineAppShell } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { canAccessAdmin, userCanAccessAdmin } from "../../utils/permissions";
import { PageHeaderContext } from "../../context/PageHeaderContext";
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
import { isExternalViewSearch } from "../../utils/external-view";
import { AppErrorOverlay } from "../shared/AppErrorOverlay";
import { OverlayRegistrar } from "../shared/OverlayRegistrar";
import { BottomNav } from "./BottomNav";
import { AppSidebar, NAV_ITEMS, SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./AppSidebar";
import type { NavItem } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import "./AppShell.css";

function isPathActive(pathname: string, target: string): boolean {
  if (target === "/") {
    return pathname === "/";
  }

  return pathname === target || pathname.startsWith(`${target}/`);
}

function isWikiPath(pathname: string): boolean {
  return pathname === "/wiki" || pathname.startsWith("/wiki/");
}

const HAS_VIEW_TRANSITIONS = typeof document !== "undefined" && "startViewTransition" in document;

function AnimatedOutlet({ pathname, enabled }: { pathname: string; enabled: boolean }) {
  const [animKey, setAnimKey] = useState(0);
  const prevPathRef = useRef(pathname);

  const useFallbackAnim = enabled && !HAS_VIEW_TRANSITIONS;

  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      if (useFallbackAnim) {
        setAnimKey((k) => k + 1);
      }
    }
  }, [pathname, useFallbackAnim]);

  return (
    <div key={useFallbackAnim ? animKey : 0} className={useFallbackAnim ? "app-route-slide-in" : undefined}>
      <Outlet />
    </div>
  );
}

function normalizeViewingAs(role: string | null, isExternalView: boolean): string {
  if (isExternalView) {
    return "external";
  }
  return role ?? "member";
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
  const isMobile = useMediaQuery("(max-width: 767px)") ?? false;
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const isSidebarCollapsed = !isSidebarExpanded;
  const sidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  const hideNavigation = pathname === "/login" || pathname.startsWith("/register/");
  const queryClient = useQueryClient();

  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const locale = usePreferencesStore((s) => s.locale);
  const pushNotificationSound = usePreferencesStore((s) => s.pushNotificationSound);
  const notificationFeatures = useNotificationStore((state) => state.features);
  const pushEntries = useNotificationStore((state) => state.pushHistory);
  const { markFeatureAsRead, markPushAsRead, markAllPushAsRead, clearPushHistory } = useNotificationStore.getState();
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [permissionBanner, setPermissionBanner] = useState<string | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [viewingAs, setViewingAs] = useState<string>(() =>
    normalizeViewingAs(user?.role ?? null, isExternalView),
  );
  const previousPathnameRef = useRef(pathname);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isWikiInternalNavigation = isWikiPath(previousPathnameRef.current) && isWikiPath(pathname);
  const shouldAnimateRoute = !hideNavigation && true && !isWikiInternalNavigation;
  const pageHeaderContextValue = useMemo(() => ({ setActions: setHeaderActions }), []);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.dataset.locale = locale;
    if (locale === "zh") {
    }
  }, [locale]);

  useEffect(() => {
    setViewingAs(normalizeViewingAs(user?.role ?? null, isExternalView));
  }, [isExternalView, user?.role]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (pathname !== "/" || previousPathname === "/") {
      return;
    }
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
      useAuthStore.getState().clearSession();
      queryClient.clear();
      void navigate({
        to: "/login",
        search: {
          reason: "expired",
          returnTo,
        },
      });
    };

    const onForbidden = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setPermissionBanner(detail?.message ?? t("nav.permissionDenied"));
    };

    window.addEventListener("guild-api-unauthorized", onUnauthorized as EventListener);
    window.addEventListener("guild-api-forbidden", onForbidden as EventListener);
    return () => {
      window.removeEventListener("guild-api-unauthorized", onUnauthorized as EventListener);
      window.removeEventListener("guild-api-forbidden", onForbidden as EventListener);
    };
  }, [navigate, t]);

  const handlePushMessage = useCallback(
    (message: PushMessage) => {
      if (message.type === "entity_changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.cmdk.all });
        switch (message.entity_type) {
          case "announcement":
            void queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
            break;
          case "event":
            void queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
            void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
            void queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.events() });
            break;
          case "wiki":
            void queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
            break;
          case "gallery":
            void queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
            break;
          case "guild_war":
            void queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.all });
            break;
          case "member_profile":
            void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
            void queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
            break;
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
    playSound: pushNotificationSound,
  });

  const logoutMutation = useMutation({
    mutationFn: requestLogout,
    onSettled: () => {
      clearSession();
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });

  const logout = () => {
    logoutMutation.mutate();
  };

  const canSwitchView = userCanAccessAdmin(user);

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: canSwitchView,
    staleTime: Infinity,
  });

  const features = useSiteConfigStore((s) => s.features);

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
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
          const roles = rolesQuery.data ?? [];
          return canAccessAdmin(roles, viewingAs);
        }
        return true;
      }),
    [isExternalView, user, viewingAs, rolesQuery.data, features],
  );

  const mobileMainItems = useMemo(
    () => visibleNavItems.filter((item) => ["/", "/events", "/guild-war", "/roster"].includes(item.to)),
    [visibleNavItems],
  );
  const mobileMoreItems = useMemo(
    () => visibleNavItems.filter((item) => !["/", "/events", "/guild-war", "/roster"].includes(item.to)),
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
    (item: NavItem) =>
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

  const displayPushEntries = useMemo(
    () => pushEntries.filter((entry) => entry.type !== "member_online"),
    [pushEntries],
  );

  const pushHasUnread = useMemo(
    () => displayPushEntries.some((entry) => entry.readAt === null),
    [displayPushEntries],
  );

  const handlePushNotificationClick = useCallback(
    (entryId: string, type: string) => {
      markPushAsRead(entryId);

      if (type === "announcement_published") {
        markFeatureAsRead("announcements");
        void navigate({ to: "/announcements" });
        return;
      }

      if (type === "event_changed") {
        void navigate({ to: "/events" });
        return;
      }

      if (type === "wiki_changed") {
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

  const HEADER_TITLE_OVERRIDES: Record<string, string> = {
    "/profile": "nav.profile",
    "/settings": "nav.settings",
  };

  const { selectedNavKey, activePageTitle } = useMemo(() => {
    const matches = visibleNavItems
      .filter((item) => isPathActive(pathname, item.to))
      .sort((left, right) => right.to.length - left.to.length);
    const active = matches[0];
    const overrideKey = HEADER_TITLE_OVERRIDES[pathname];
    return {
      selectedNavKey: active?.to ?? "",
      activePageTitle: t(overrideKey ?? active?.labelKey ?? "nav.dashboard"),
    };
  }, [pathname, t, visibleNavItems]);

  if (hideNavigation) {
    return (
      <PageHeaderContext.Provider value={pageHeaderContextValue}>
      <ViewingAsProvider value={viewingAs}>
        <div className="app-login-layout">
          <main className="app-login-content">
            <div className="app-login-panel">
              <Outlet />
            </div>
          </main>
        </div>
      </ViewingAsProvider>
      </PageHeaderContext.Provider>
    );
  }

  return (
    <PageHeaderContext.Provider value={pageHeaderContextValue}>
    <ViewingAsProvider value={viewingAs}>
      <a href="#main-content" className="app-skip-link">{t("nav.skipToContent", "Skip to content")}</a>
      <MantineAppShell
        className="app-shell-root"
        layout="alt"
        header={{ height: isMobile ? 56 : 64 }}
        navbar={!isMobile ? { width: sidebarWidth, breakpoint: "md" } : undefined}
        padding={0}
      >
        <ScrollProgress thicknessPx={3} zIndex={1000} container={scrollContainerRef} />
        <OverlayRegistrar />
        <AppErrorOverlay />

        {!isMobile ? (
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
          activePageTitle={activePageTitle}
          headerActions={headerActions}
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

        <MantineAppShell.Main id="main-content" ref={scrollContainerRef} className={`app-content ${isMobile ? "app-content-mobile" : ""}`}>
          <div className="app-main">
            {isExternalView ? (
              <Alert color="blue" variant="light" className="app-banner">
                {t("nav.externalViewBanner")}
              </Alert>
            ) : null}
            {!isOnline ? (
              <Alert color="yellow" variant="light" className="app-banner" role="status" aria-live="polite">
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
            <div className="app-route-container">
              <AnimatedOutlet pathname={pathname} enabled={shouldAnimateRoute} />
            </div>
          </div>
        </MantineAppShell.Main>

        {isMobile ? (
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
    </PageHeaderContext.Provider>
  );
}
