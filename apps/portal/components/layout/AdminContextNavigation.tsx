import type { AdminRole, Permission, User } from "@guild/shared";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { LeftOutlined } from "../../utils/icons";
import type { BottomNavItem } from "./BottomNav";
import {
  ADMIN_CONTEXT_ROUTES,
  ADMIN_CONTEXT_NAV_GROUPS,
  findAdminContextRoute,
  groupAdminContextRoutes,
  isAdminContextRouteVisible,
  isAdminContextTab,
  resolveAdminContextTab,
  type AdminContextTab,
} from "./admin-context-nav";

export type AdminContextNavigationStatus = {
  memberCount: number | null;
  inviteActiveCount: number | null;
  inviteHasExpired: boolean;
  roleCount: number | null;
  healthState: "ok" | "configured" | "degraded" | "checking" | null;
};

type AdminContextNavigationValue = {
  status: AdminContextNavigationStatus;
  setStatus: Dispatch<SetStateAction<AdminContextNavigationStatus>>;
};

const INITIAL_STATUS: AdminContextNavigationStatus = {
  memberCount: null,
  inviteActiveCount: null,
  inviteHasExpired: false,
  roleCount: null,
  healthState: null,
};

const AdminContextNavigationContext = createContext<AdminContextNavigationValue | null>(null);

export function AdminContextNavigationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminContextNavigationStatus>(INITIAL_STATUS);
  const value = useMemo(() => ({ status, setStatus }), [status]);

  return (
    <AdminContextNavigationContext.Provider value={value}>
      {children}
    </AdminContextNavigationContext.Provider>
  );
}

export function useAdminContextNavigation() {
  const value = useContext(AdminContextNavigationContext);
  if (!value) {
    throw new Error("useAdminContextNavigation must be used inside AdminContextNavigationProvider");
  }
  return value;
}

type AdminContextNavigationModelOptions = {
  pathname: string;
  searchStr: string;
  viewingAs: string;
  user: User | null | undefined;
  roles: AdminRole[];
};

export function useAdminContextNavigationModel({
  pathname,
  searchStr,
  viewingAs,
  user,
  roles,
}: AdminContextNavigationModelOptions) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { status } = useAdminContextNavigation();
  const isAdminContext = pathname === "/admin" || pathname.startsWith("/admin/");
  const requestedTab = useMemo(
    () => resolveAdminContextTab(new URLSearchParams(searchStr).get("tab") ?? undefined),
    [searchStr],
  );
  const canManage = useCallback((permissions: Permission[]) => {
    if (viewingAs === "external") return false;
    if (viewingAs === user?.role) {
      return permissions.some((permission) => user.permissions[permission] === true);
    }
    const viewedRole = roles.find((role) => role.id === viewingAs);
    return permissions.some((permission) => viewedRole?.permissions[permission] === true);
  }, [roles, user, viewingAs]);
  const visibleRoutes = useMemo(
    () => ADMIN_CONTEXT_ROUTES.filter((route) => isAdminContextRouteVisible(route, canManage)),
    [canManage],
  );
  const activeTab = useMemo(
    () => (
      visibleRoutes.some((route) => route.tab === requestedTab)
        ? requestedTab
        : visibleRoutes[0]?.tab ?? requestedTab
    ),
    [requestedTab, visibleRoutes],
  );
  const activeRoute = useMemo(() => findAdminContextRoute(activeTab), [activeTab]);
  const navigateContext = useCallback((tab: AdminContextTab) => {
    void navigate({
      to: "/admin",
      search: (previous) => ({ ...previous, tab: tab === "member" ? undefined : tab }),
      viewTransition: false,
    });
  }, [navigate]);
  const navigateContextItem = useCallback((itemId: string) => {
    if (isAdminContextTab(itemId)) {
      navigateContext(itemId);
    }
  }, [navigateContext]);
  const sidebarGroups = useMemo(
    () => groupAdminContextRoutes(visibleRoutes).map((group) => ({
      ...group,
      routes: group.routes.map((route) => ({
        id: route.tab,
        labelKey: route.labelKey,
        icon: route.icon,
        rightSection: route.tab === "member" && status.memberCount !== null ? (
          <span className="app-nav-count app-nav-item__meta">{status.memberCount}</span>
        ) : route.tab === "invite" && status.inviteActiveCount !== null ? (
          <span className={`app-nav-count app-nav-item__meta${status.inviteHasExpired ? " app-nav-count--warn" : ""}`}>
            {status.inviteActiveCount}
          </span>
        ) : route.tab === "roles" && status.roleCount !== null ? (
          <span className="app-nav-count app-nav-item__meta">{status.roleCount}</span>
        ) : route.tab === "operations" && status.healthState ? (
          <span
            className={`app-nav-status app-nav-item__meta app-nav-status--${status.healthState}`}
            role="img"
            aria-label={t(`admin:header.health.${status.healthState}`)}
          />
        ) : undefined,
      })),
    })),
    [status, t, visibleRoutes],
  );
  const bottomItems = useMemo<BottomNavItem[]>(() => [
    {
      id: "portal",
      to: "/dashboard",
      label: t("nav.returnToPortal"),
      icon: LeftOutlined,
      groupLabel: t("nav.group.overview"),
      onSelect: () => void navigate({ to: "/dashboard" }),
    },
    ...groupAdminContextRoutes(visibleRoutes).flatMap((group) => {
      const groupLabelKey = ADMIN_CONTEXT_NAV_GROUPS.find((entry) => entry.id === group.id)?.labelKey;
      return group.routes.map((route) => ({
        id: route.tab,
        to: "/admin",
        label: t(route.labelKey),
        icon: route.icon,
        groupLabel: groupLabelKey ? t(groupLabelKey) : undefined,
        active: route.tab === activeTab,
        onSelect: () => navigateContext(route.tab),
      }));
    }),
  ], [activeTab, navigate, navigateContext, t, visibleRoutes]);

  return {
    isAdminContext,
    activeRoute,
    activeTab,
    sidebarGroups,
    bottomItems,
    navigateContextItem,
  };
}

export { INITIAL_STATUS as initialAdminContextNavigationStatus };
