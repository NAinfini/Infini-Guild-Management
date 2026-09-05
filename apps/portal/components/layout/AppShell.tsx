import { IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { setI18nLocale } from "../../i18n";
import { canAccessAdmin, userCanAccessAdmin } from "../../utils/permissions";
import { ViewingAsProvider } from "../../context/ViewingAsContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { queryKeys } from "../../api/query-keys";
import { logout as requestLogout } from "../../services/AuthService";
import { fetchRoles } from "../../services/AdminService";
import { useAuthStore } from "../../stores/auth";
import { usePreferencesStore } from "../../stores/preferences";
import { useSiteConfigStore } from "../../stores/site-config";
import {
  installSessionSynchronization,
  logoutSession,
  revalidateSessionSnapshot,
} from "../../session-transition";
import { isExternalViewSearch } from "../../utils/external-view";
import { notifyWarning } from "../../utils/notifications";
import { currentReturnTo } from "../../utils/auth-navigation";
import { AppErrorOverlay } from "../shared/AppErrorOverlay";
import { VisualThemeScene } from "../shared/VisualThemeArtwork";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
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
import { ImportantNoticeGate } from "./ImportantNoticeGate";
import {
  findPortalRoute,
  groupPortalRoutes,
  PORTAL_ROUTES,
} from "./route-metadata";
import {
  AdminContextNavigationProvider,
  useAdminContextNavigationModel,
} from "./AdminContextNavigation";
import { useAppShellPushNotifications } from "./useAppShellPushNotifications";
import "./AppShell.css";
function normalizeViewingAs(role: string | null, isExternalView: boolean): string {
  if (isExternalView) {
    return "external";
  }
  return role ?? "external";
}

function syncViewSearch(nextRole: string) {
  const url = new URL(window.location.href);
  if (nextRole === "external") {
    url.searchParams.set("preview", "external");
  } else {
    url.searchParams.delete("preview");
  }
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AppShell() {
  return (
    <AdminContextNavigationProvider>
      <AppShellContent />
    </AdminContextNavigationProvider>
  );
}

function ShellBanner({
  children,
  status,
  onClose,
  closeLabel,
}: {
  children: ReactNode;
  status: "neutral" | "warning" | "danger";
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <Alert className="app-banner" data-status={status} role="status" aria-live="polite">
      <AlertDescription>{children}</AlertDescription>
      {onClose ? (
        <AlertAction>
          <button type="button" className="app-banner__close" aria-label={closeLabel} onClick={onClose}>
            <IconX aria-hidden="true" />
          </button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

function AppShellContent() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  const shellLocation = useRouterState({
    select: (state) => state.resolvedLocation ?? state.location,
  });
  const pathname = shellLocation.pathname;
  const activeRoute = useMemo(() => findPortalRoute(pathname), [pathname]);
  const searchStr = shellLocation.searchStr;
  const isExternalView = isExternalViewSearch(searchStr);
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`) ?? false;
  const usesCompactNavigation = useMediaQuery(`(max-width: ${COMPACT_NAV_BREAKPOINT_PX}px)`) ?? false;
  const isHeaderCompact = useMediaQuery(`(max-width: ${HEADER_COMPACT_BREAKPOINT_PX}px)`) ?? false;
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const isSidebarCollapsed = !isSidebarExpanded;
  const sidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const siteName = useSiteConfigStore((state) => state.siteName);
  const sessionScope = useAuthStore((s) => s.sessionScope);
  const passwordChangeOnly = sessionScope === "password_change";
  const isGuestLanding = pathname === "/" && !user && !passwordChangeOnly;
  // Focused auth/status flows render their own public frame instead of portal chrome.
  const hideNavigation = pathname === "/login"
    || pathname === "/register"
    || pathname.startsWith("/register/")
    || pathname === "/verify-email"
    || pathname === "/403"
    || pathname === "/maintenance"
    || activeRoute.to === "/__not-found__"
    || passwordChangeOnly;
  const locale = usePreferencesStore((s) => s.locale);
  const sessionRefreshFailureMessageRef = useRef(t);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [permissionBanner, setPermissionBanner] = useState<string | null>(null);
  const [viewingAs, setViewingAs] = useState<string>(() =>
    normalizeViewingAs(user?.role ?? null, isExternalView),
  );

  useEffect(() => {
    void setI18nLocale(locale);
  }, [locale]);

  useEffect(() => {
    sessionRefreshFailureMessageRef.current = t;
  }, [t]);

  useEffect(() => {
    setViewingAs(normalizeViewingAs(user?.role ?? null, isExternalView));
  }, [isExternalView, user?.role]);

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

  const expirePushSession = useCallback(() => {
    if (!useAuthStore.getState().user || window.location.pathname === "/login") return;
    // The socket may belong to an earlier login; only the current cookie can expire this session.
    void revalidateSessionSnapshot(queryClient).then((session) => {
      if (session || useAuthStore.getState().user) return;
      void navigate({
        to: "/login",
        search: { reason: "expired", returnTo: currentReturnTo() },
      });
    }).catch(() => {
      notifyWarning(sessionRefreshFailureMessageRef.current("admin:message.sessionRefreshFailed"));
    });
  }, [navigate, queryClient]);

  useEffect(() => {
    const onForbidden = () => {
      setPermissionBanner(t("nav.permissionDenied"));
    };

    window.addEventListener("guild-api-forbidden", onForbidden as EventListener);
    return () => {
      window.removeEventListener("guild-api-forbidden", onForbidden as EventListener);
    };
  }, [t]);

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
      .catch(() => {
        notifyWarning(sessionRefreshFailureMessageRef.current("admin:message.sessionRefreshFailed"));
      })
      .finally(() => {
        sessionRevalidationRef.current = null;
      });
    sessionRevalidationRef.current = request;
  }, [queryClient]);

  useEffect(() => {
    window.addEventListener("focus", revalidateSession);
    return () => window.removeEventListener("focus", revalidateSession);
  }, [revalidateSession, user?.id]);

  useAppShellPushNotifications({
    queryClient,
    enabled: Boolean(user) && sessionScope === "normal",
    onUnauthorized: expirePushSession,
  });

  const logoutMutation = useMutation({
    mutationFn: () => logoutSession(queryClient, requestLogout),
    onMutate: () => {
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
    enabled: canSwitchView && sessionScope === "normal",
    staleTime: Infinity,
  });

  const features = useSiteConfigStore((s) => s.features);

  const visiblePortalNavItems = useMemo(
    () =>
      PORTAL_ROUTES.filter((item) => {
        if (item.featureFlag && !features[item.featureFlag]) {
          return false;
        }
        if (isExternalView && item.requiresSession) {
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

  const adminNavigation = useAdminContextNavigationModel({
    pathname,
    searchStr,
    viewingAs,
    user,
    roles: rolesQuery.data ?? [],
  });

  const mobileMainItems = useMemo(
    () =>
      visiblePortalNavItems
        .filter((item) => item.mobilePrimary)
        .sort((left, right) => (left.mobilePrimary ?? 0) - (right.mobilePrimary ?? 0)),
    [visiblePortalNavItems],
  );
  const mobileMoreItems = useMemo(
    () => visiblePortalNavItems.filter((item) => !item.mobilePrimary),
    [visiblePortalNavItems],
  );

  const portalSidebarGroups = useMemo(
    () => groupPortalRoutes(visiblePortalNavItems).map((group) => ({
      ...group,
      routes: group.routes.map((route) => ({
        id: route.to,
        labelKey: route.labelKey,
        icon: route.icon,
      })),
    })),
    [visiblePortalNavItems],
  );
  const sidebarNavGroups = adminNavigation.isAdminContext ? adminNavigation.sidebarGroups : portalSidebarGroups;
  const selectedNavKey = adminNavigation.isAdminContext ? adminNavigation.activeTab : activeRoute.to;
  const activeNavigationRoute = adminNavigation.isAdminContext ? adminNavigation.activeRoute : activeRoute;
  const activePageTitle = t(activeNavigationRoute.labelKey);
  const activePageIcon = activeNavigationRoute.icon;
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    if (hideNavigation || isGuestLanding) return;
    document.title = siteName ? `${activePageTitle} · ${siteName}` : activePageTitle;
  }, [activePageTitle, hideNavigation, isGuestLanding, siteName]);

  useEffect(() => {
    const routeChanged = previousPathnameRef.current !== pathname;
    previousPathnameRef.current = pathname;
    if (!routeChanged || hideNavigation || isGuestLanding) return;

    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".app-header__page-title")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hideNavigation, isGuestLanding, pathname]);
  const compactMainItems = adminNavigation.isAdminContext
    ? adminNavigation.bottomItems.slice(0, 4)
    : mobileMainItems.map((item) => ({
        to: item.to,
        label: t(item.labelKey),
        icon: item.icon,
      }));
  const compactMoreItems = adminNavigation.isAdminContext
    ? adminNavigation.bottomItems.slice(4)
    : groupPortalRoutes(mobileMoreItems).flatMap((group) => group.routes.map((item) => ({
      to: item.to,
      label: t(item.labelKey),
      icon: item.icon,
      groupLabel: t(group.labelKey),
    })));

  /*
   * 区域色下发到 <html>，与 data-theme / data-accent 同一个元素。
   * 必须是同一个元素：semantic.css 里 --domain-tint 这类派生 token 用 color-mix
   * 读 --domain，而自定义属性的派生值在「定义它的那个元素」上就算完了——挂在
   * 外壳容器上，:root 那份派生只会读到默认值，子树再怎么覆盖 --domain 都不重算。
   *
   * 无区域的路由（仪表盘、我的资料、设置、登录、404）删掉属性而不是写空串：
   * 空串会命中 [data-domain] 存在性选择器，属性不存在才回落到 :root 的品牌色。
   */
  useEffect(() => {
    const root = document.documentElement;
    if (activeRoute.domain) {
      root.dataset.domain = activeRoute.domain;
    } else {
      delete root.dataset.domain;
    }
  }, [activeRoute.domain]);

  if (isGuestLanding) {
    return (
      <ViewingAsProvider value={viewingAs}>
        <div className="app-public-layout">
          <Outlet />
        </div>
      </ViewingAsProvider>
    );
  }

  if (hideNavigation) {
    return (
      <ViewingAsProvider value={viewingAs}>
        {passwordChangeOnly ? null : <ImportantNoticeGate />}
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
      <ImportantNoticeGate />
      <a href="#main-content" className="app-skip-link">{t("nav.skipToContent", "Skip to content")}</a>
      <div
        className="app-shell-root"
        data-compact-navigation={usesCompactNavigation || undefined}
        style={{ "--app-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <VisualThemeScene variant={`workspace-${activeRoute.workspaceScene}`} className="app-workspace-scene" loading="eager" />
        <AppErrorOverlay />

        {!usesCompactNavigation ? (
          <AppSidebar
            isSidebarCollapsed={isSidebarCollapsed}
            onCollapse={() => setIsSidebarExpanded(false)}
            onExpand={() => setIsSidebarExpanded(true)}
            navGroups={sidebarNavGroups}
            selectedNavKey={selectedNavKey}
            onNavigate={(item) => {
              if (adminNavigation.isAdminContext) {
                adminNavigation.navigateContextItem(item.id);
                return;
              }
              void navigate({ to: item.id as never });
            }}
            onReturnToPortal={adminNavigation.isAdminContext ? () => void navigate({ to: "/dashboard" }) : undefined}
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
          activePageIcon={activePageIcon}
          user={user}
          onLogout={logout}
          onLoginClick={() => void navigate({ to: "/login" })}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className={`app-content${usesCompactNavigation ? " app-content-mobile" : ""}`}
        >
          <div className="app-main">
            {isExternalView ? (
              <ShellBanner status="neutral">
                {t("nav.externalViewBanner")}
              </ShellBanner>
            ) : null}
            {!isOnline ? (
              <ShellBanner status="warning">
                {t("nav.offlineBanner")}
              </ShellBanner>
            ) : null}
            {permissionBanner ? (
              <ShellBanner
                status="danger"
                onClose={() => setPermissionBanner(null)}
                closeLabel={t("action.close")}
              >
                {permissionBanner}
              </ShellBanner>
            ) : null}
            <div className="app-route-container" data-content-width={activeRoute.contentWidth}>
              <Outlet />
            </div>
          </div>
        </main>

        {usesCompactNavigation ? (
          <BottomNav
            pathname={pathname}
            mainItems={compactMainItems}
            moreItems={compactMoreItems}
          />
        ) : null}
      </div>
    </ViewingAsProvider>
  );
}
