import { hasRoleAtLeast, type PushMessage } from "@guild/shared";
import {
  BookOutlined,
  CalendarOutlined,
  ControlOutlined,
  DashboardOutlined,
  FireOutlined,
  LeftOutlined,
  MoonOutlined,
  NotificationOutlined,
  PictureOutlined,
  RightOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  TranslationOutlined,
  ToolOutlined,
  UserOutlined,
} from "../../utils/icons";
import { listThemeIds } from "@infini-dev-kit/frontend/theme/theme-specs";
import type { ThemeId } from "@infini-dev-kit/frontend/theme/theme-types";
import { ScrollProgress, InfiniButton } from "@infini-dev-kit/frontend/components";
import { useBridge, useThemeSnapshot, loadLocaleFonts } from "@infini-dev-kit/frontend/provider";
import type { IconProps } from "@tabler/icons-react";
import {
  ActionIcon,
  Alert,
  AppShell as MantineAppShell,
  Badge,
  Group,
  Indicator,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import i18n from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType, type ReactNode } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../../api/client";
import { queryKeys } from "../../api/query-keys";
import { fetchRoles } from "../../api/queries/roles";
import { PageHeaderContext } from "../../context/PageHeaderContext";
import { useNotificationPresentation } from "../../hooks/useNotificationPresentation";
import { useNotificationSync } from "../../hooks/useNotificationSync";
import { useAuthStore } from "../../stores/auth";
import { useNotificationStore, type NotificationFeature } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { isExternalViewSearch } from "../../utils/external-view";
import { AppErrorOverlay } from "../shared/AppErrorOverlay";
import { EmptyState } from "../shared/EmptyState";
import { OverlayRegistrar } from "../shared/OverlayRegistrar";
import { BottomNav } from "./BottomNav";
import { CmdKSearch } from "./CmdKSearch";
import { UserProfileDropdown } from "./UserProfileDropdown";
import { ViewingAsSelector } from "./ViewingAsSelector";
import "./AppShell.css";

type NavItem = {
  to: string;
  labelKey: string;
  icon: ComponentType<IconProps>;
  requiresSession?: boolean;
  requiresModerator?: boolean;
  feature?: NotificationFeature;
};

const SIDEBAR_WIDTH = 236;
const SIDEBAR_COLLAPSED_WIDTH = 56;

type SidebarLabelProps = {
  children: ReactNode;
  collapsed: boolean;
  className?: string;
  style?: CSSProperties;
};

type SidebarExpandOverlayProps = {
  children: ReactNode;
  collapsed: boolean;
  onExpand: () => void;
  className?: string;
};

function SidebarLabel({ children, collapsed, className, style }: SidebarLabelProps) {
  return (
    <span
      className={className}
      style={{
        ...style,
        whiteSpace: "nowrap",
        overflow: "hidden",
        display: "inline-block",
        opacity: collapsed ? 0 : 1,
        maxWidth: collapsed ? 0 : 160,
        transition: "opacity 160ms ease, max-width 160ms ease",
      }}
    >
      {children}
    </span>
  );
}

function SidebarExpandOverlay({ children, collapsed, onExpand, className }: SidebarExpandOverlayProps) {
  if (!collapsed) {
    return null;
  }

  return (
    <span
      className={className}
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onExpand();
        }
      }}
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
      }}
    >
      {children}
    </span>
  );
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: DashboardOutlined },
  { to: "/announcements", labelKey: "nav.announcements", icon: NotificationOutlined, feature: "announcements" },
  { to: "/roster", labelKey: "nav.roster", icon: TeamOutlined, feature: "members" },
  { to: "/events", labelKey: "nav.events", icon: CalendarOutlined },
  { to: "/guild-war", labelKey: "nav.guild-war", icon: ThunderboltOutlined },
  { to: "/gallery", labelKey: "nav.gallery", icon: PictureOutlined },
  { to: "/wiki", labelKey: "nav.wiki", icon: BookOutlined },
  { to: "/tools", labelKey: "nav.tools", icon: ToolOutlined },
  { to: "/profile", labelKey: "nav.profile", icon: UserOutlined, requiresSession: true },
  {
    to: "/admin",
    labelKey: "nav.admin",
    icon: SettingOutlined,
    requiresSession: true,
    requiresModerator: true,
  },
  { to: "/settings", labelKey: "nav.settings", icon: ControlOutlined },
];

function isPathActive(pathname: string, target: string): boolean {
  if (target === "/") {
    return pathname === "/";
  }

  return pathname === target || pathname.startsWith(`${target}/`);
}

function isWikiPath(pathname: string): boolean {
  return pathname === "/wiki" || pathname.startsWith("/wiki/");
}

/**
 * Renders <Outlet /> with route transition animation.
 *
 * When the View Transition API is supported (`defaultViewTransition` on the router),
 * the browser handles the old→new cross-fade via ::view-transition pseudos.
 * On older browsers, falls back to a CSS slide-in on the new content only.
 */
const HAS_VIEW_TRANSITIONS = typeof document !== "undefined" && "startViewTransition" in document;

function AnimatedOutlet({ pathname, enabled }: { pathname: string; enabled: boolean }) {
  const [animKey, setAnimKey] = useState(0);
  const prevPathRef = useRef(pathname);

  // When View Transitions are available, the router handles the animation.
  // We only need the manual CSS fallback for browsers without the API.
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
  const bridge = useBridge();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const { theme: themeSnapshot, motion: motionSnapshot } = useThemeSnapshot();
  const isExternalView = isExternalViewSearch(searchStr);
  const isMobile = useMediaQuery("(max-width: 767px)") ?? false;
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const isSidebarCollapsed = !isSidebarExpanded;
  const sidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  const hideNavigation = pathname === "/login" || pathname.startsWith("/register/");
  const queryClient = useQueryClient();

  const { user, clearSession } = useAuthStore();
  const { locale, setLocale, pushNotificationSound } = usePreferencesStore();
  const notificationFeatures = useNotificationStore((state) => state.features);
  const pushEntries = useNotificationStore((state) => state.pushHistory);
  const markFeatureAsRead = useNotificationStore((state) => state.markFeatureAsRead);
  const markPushAsRead = useNotificationStore((state) => state.markPushAsRead);
  const markAllPushAsRead = useNotificationStore((state) => state.markAllPushAsRead);
  const themeIds = useMemo(() => listThemeIds(), []);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [permissionBanner, setPermissionBanner] = useState<string | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [viewingAs, setViewingAs] = useState<string>(() =>
    normalizeViewingAs(user?.role ?? null, isExternalView),
  );
  const previousPathnameRef = useRef(pathname);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isWikiInternalNavigation = isWikiPath(previousPathnameRef.current) && isWikiPath(pathname);
  const shouldAnimateRoute = !hideNavigation && motionSnapshot.effectiveMode !== "off" && !isWikiInternalNavigation;
  const pageHeaderContextValue = useMemo(() => ({ setActions: setHeaderActions }), []);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.dataset.locale = locale;
    if (locale === "zh") {
      void loadLocaleFonts(locale);
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
      const detail = (event as CustomEvent<{ returnTo?: string }>).detail;
      const returnTo =
        detail?.returnTo && detail.returnTo.startsWith("/")
          ? detail.returnTo
          : `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (window.location.pathname === "/login") {
        return;
      }
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
      setPermissionBanner(detail?.message ?? "You do not have permission for this action.");
    };

    window.addEventListener("guild-api-unauthorized", onUnauthorized as EventListener);
    window.addEventListener("guild-api-forbidden", onForbidden as EventListener);
    return () => {
      window.removeEventListener("guild-api-unauthorized", onUnauthorized as EventListener);
      window.removeEventListener("guild-api-forbidden", onForbidden as EventListener);
    };
  }, [navigate]);

  const handlePushMessage = useCallback(
    (message: PushMessage) => {
      if (message.type === "entity_changed" && message.entity_type === "event") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      }
      if (message.type === "event_reminder") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
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
    mutationFn: () => apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      clearSession();
      void navigate({ to: "/login" });
    },
  });

  const logout = () => {
    logoutMutation.mutate();
  };

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (isExternalView && (item.to === "/profile" || item.to === "/admin")) {
          return false;
        }
        if (item.requiresSession && !user) {
          return false;
        }
        if (item.requiresModerator && (!user || !hasRoleAtLeast(user.role, "moderator"))) {
          return false;
        }
        return true;
      }),
    [isExternalView, user],
  );

  const mobileMainItems = visibleNavItems.filter((item) =>
    ["/", "/events", "/guild-war", "/roster"].includes(item.to),
  );
  const mobileMoreItems = visibleNavItems.filter(
    (item) => !["/", "/events", "/guild-war", "/roster"].includes(item.to),
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
    (entryId: string, type: PushMessage["type"]) => {
      markPushAsRead(entryId);

      if (type === "announcement_published") {
        markFeatureAsRead("announcements");
        void navigate({ to: "/announcements" });
        return;
      }

      if (type === "event_reminder") {
        void navigate({ to: "/events" });
      }
    },
    [markFeatureAsRead, markPushAsRead, navigate],
  );

  const selectedNavKey = useMemo(() => {
    const matches = visibleNavItems
      .filter((item) => isPathActive(pathname, item.to))
      .sort((left, right) => right.to.length - left.to.length);
    return matches[0]?.to ?? "";
  }, [pathname, visibleNavItems]);

  const activePageTitle = useMemo(() => {
    const activeItem = visibleNavItems
      .filter((item) => isPathActive(pathname, item.to))
      .sort((left, right) => right.to.length - left.to.length)[0];
    return t(activeItem?.labelKey ?? "nav.dashboard");
  }, [pathname, t, visibleNavItems]);

  const canSwitchView = Boolean(user && hasRoleAtLeast(user.role, "moderator"));

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: canSwitchView,
  });

  if (hideNavigation) {
    return (
      <PageHeaderContext.Provider value={pageHeaderContextValue}>
        <div className="app-login-layout">
          <main className="app-login-content">
            <div className="app-login-panel">
              <Outlet />
            </div>
          </main>
        </div>
      </PageHeaderContext.Provider>
    );
  }

  return (
    <PageHeaderContext.Provider value={pageHeaderContextValue}>
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
          <MantineAppShell.Navbar
            className={`app-sider ${isSidebarCollapsed ? "app-sider--collapsed" : ""}`}
          >
            <div className="app-brand">
              <div className="app-brand-main">
                <div
                  className={`app-brand-mark ${isSidebarCollapsed ? "app-brand-mark--has-expand" : ""}`}
                  style={{ position: "relative" }}
                >
                  <FireOutlined />
                  <SidebarExpandOverlay
                    collapsed={isSidebarCollapsed}
                    onExpand={() => setIsSidebarExpanded(true)}
                    className="app-brand-expand-overlay"
                  >
                    <RightOutlined />
                  </SidebarExpandOverlay>
                </div>
                <SidebarLabel collapsed={isSidebarCollapsed} className="app-brand-title-wrap">
                  <Title order={4} className="app-brand-title">
                    {t("app.title")}
                  </Title>
                </SidebarLabel>
              </div>
              {!isSidebarCollapsed ? (
                <div className="app-sider-controls">
                  <ActionIcon
                    variant="subtle"
                    className="app-sider-control-btn"
                    aria-label="Collapse sidebar"
                    onClick={() => {
                      setIsSidebarExpanded(false);
                    }}
                  >
                    <LeftOutlined />
                  </ActionIcon>
                </div>
              ) : null}
            </div>

            <ScrollArea className="app-sider-menu" type="scroll" scrollbarSize={6}>
              <Stack gap={8} p={8}>
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.to === selectedNavKey;
                  return (
                    <UnstyledButton
                      key={item.to}
                      title={isSidebarCollapsed ? t(item.labelKey) : undefined}
                      className={`app-nav-item ${active ? "app-nav-item--active" : ""}`}
                      onClick={() => {
                        markFeatureAsReadForPath(item.to);
                        void navigate({ to: item.to as never });
                      }}
                    >
                      <Group gap={10} wrap="nowrap" justify="flex-start">
                        <Indicator disabled={!navHasNew(item)} offset={2} size={7} inline>
                          <span className="app-nav-icon">
                            <Icon />
                          </span>
                        </Indicator>
                        <SidebarLabel collapsed={isSidebarCollapsed} className="app-nav-label">{t(item.labelKey)}</SidebarLabel>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </ScrollArea>

            {canSwitchView ? (
              <ViewingAsSelector
                value={viewingAs}
                compact={isSidebarCollapsed}
                roles={rolesQuery.data ?? []}
                onChange={(nextRole) => {
                  setViewingAs(nextRole);
                  syncViewSearch(nextRole);
                }}
              />
            ) : null}
          </MantineAppShell.Navbar>
        ) : null}

        <MantineAppShell.Header className="app-header">
          <div className="app-header__left">
            <Text fw={700} className="app-header__page-title">
              {activePageTitle}
            </Text>
          </div>

          <div className="app-header__center">{headerActions}</div>

          <div className="app-header__right">
            <div className="app-header-tools">
              {!isMobile ? <CmdKSearch /> : null}
              <Popover width={420} position="bottom-end" shadow="md" withArrow onOpen={() => { markAllPushAsRead(); markFeatureAsRead("announcements"); }}>
                <Popover.Target>
                  <ActionIcon variant="subtle" className="app-header-icon-btn" aria-label={t("label.notifications")}>
                    <Indicator
                      disabled={
                        !Boolean(
                          user &&
                            (pushHasUnread ||
                              notificationFeatures.announcements.hasNew),
                        )
                      }
                      offset={1}
                      size={8}
                      inline
                    >
                      <NotificationOutlined />
                    </Indicator>
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown className="app-header-notifications-popover">
                  <div className="app-header-notifications-overlay">
                    <div className="app-header-notifications-head">
                      <Text fw={600}>{t("label.notifications")}</Text>
                    </div>

                    {displayPushEntries.length === 0 ? (
                      <EmptyState title={t("notification.empty")} />
                    ) : (
                      <Stack gap={6} className="app-header-notifications-list">
                        {displayPushEntries.map((item) => (
                          <UnstyledButton
                            key={item.id}
                            className={`app-header-notification-item ${
                              item.readAt === null ? "app-header-notification-item--unread" : ""
                            }`}
                            onClick={() => handlePushNotificationClick(item.id, item.type)}
                          >
                            <div className="app-header-notification-row">
                              <Stack gap={4} align="flex-start">
                                <Group gap={8} wrap="nowrap">
                                  <Text fw={600}>{item.title}</Text>
                                  {item.type === "announcement_published" ? (
                                    <Badge variant="light" color="infini-primary">
                                      {t("notification.type.announcement")}
                                    </Badge>
                                  ) : null}
                                  {item.type === "event_reminder" ? (
                                    <Badge variant="light" color="infini-warning">
                                      {t("notification.type.eventReminder")}
                                    </Badge>
                                  ) : null}
                                </Group>
                                <Group gap={8}>
                                  <Text c="dimmed" size="sm">
                                    {item.message}
                                  </Text>
                                </Group>
                              </Stack>
                              <Text c="dimmed" className="app-header-notification-time">
                                {formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true })}
                              </Text>
                            </div>
                          </UnstyledButton>
                        ))}
                      </Stack>
                    )}
                  </div>
                </Popover.Dropdown>
              </Popover>

              <Menu shadow="md" width={220} position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" className="app-header-icon-btn" aria-label={t("label.theme")}>
                    <MoonOutlined />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {themeIds.map((themeId) => (
                    <Menu.Item
                      key={themeId}
                      onClick={() => {
                        const nextThemeId = themeId as ThemeId;
                        bridge.setTheme(nextThemeId);
                      }}
                      style={{ fontWeight: themeSnapshot.id === themeId ? 700 : 400 }}
                    >
                      {themeId}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>

              <Menu shadow="md" width={160} position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" className="app-header-icon-btn" aria-label={t("label.locale")}>
                    <TranslationOutlined />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => setLocale("en")} style={{ fontWeight: locale === "en" ? 700 : 400 }}>
                    English
                  </Menu.Item>
                  <Menu.Item onClick={() => setLocale("zh")} style={{ fontWeight: locale === "zh" ? 700 : 400 }}>
                    中文
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>

            {user ? (
              <UserProfileDropdown user={user} onLogout={logout} compact />
            ) : (
              <InfiniButton onClick={() => void navigate({ to: "/login" })}>
                {t("action.login")}
              </InfiniButton>
            )}
          </div>
        </MantineAppShell.Header>

        <MantineAppShell.Main ref={scrollContainerRef} className={`app-content ${isMobile ? "app-content-mobile" : ""}`}>
          <main className="app-main">
            {isExternalView ? (
              <Alert color="infini-primary" variant="light" className="app-banner">
                External view is enabled. Editing and private fields are hidden.
              </Alert>
            ) : null}
            {!isOnline ? (
              <Alert color="infini-warning" variant="light" className="app-banner" role="status" aria-live="polite">
                You are offline. Some actions may fail until connection is restored.
              </Alert>
            ) : null}
            {permissionBanner ? (
              <Alert
                color="infini-danger"
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
          </main>
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
    </PageHeaderContext.Provider>
  );
}

