import type { Permission } from "@guild/shared";
import type { IconProps } from "@tabler/icons-react";
import { createElement, type ComponentType } from "react";
import {
  FileSearchIcon,
  HeartbeatIcon,
  InfoCircleIcon,
  LinkIcon,
  SettingsIcon,
  ShieldIcon,
  SwordIcon,
  TrophyIcon,
  UsersIcon,
  WrenchIcon,
} from "@portal/components/icons";

export type AdminContextGroup = "people" | "config" | "ops" | "governance";

type AdminContextRouteDefinition = {
  tab: string;
  group: AdminContextGroup;
  labelKey: string;
  icon: ComponentType<IconProps>;
  permissions: readonly Permission[];
};

function defineAdminContextRoutes<const Routes extends readonly AdminContextRouteDefinition[]>(routes: Routes) {
  return routes;
}

type NumericSizedIcon = ComponentType<{ size?: number }>;

/*
 * The animated house icons deliberately accept only numerical sizes, while
 * the surrounding Portal navigation still uses Tabler's broader icon shape.
 * Navigation only supplies a size, so adapt at this registry boundary rather
 * than pretending the house icons implement SVG attributes they do not use.
 */
function asNavigationIcon(Icon: NumericSizedIcon): ComponentType<IconProps> {
  return function NavigationIcon({ size }: IconProps) {
    return createElement(Icon, { size: typeof size === "number" ? size : undefined });
  };
}

export const ADMIN_CONTEXT_NAV_GROUPS = [
  { id: "people", labelKey: "admin:nav.group.people" },
  { id: "config", labelKey: "admin:nav.group.config" },
  { id: "ops", labelKey: "admin:nav.group.ops" },
  { id: "governance", labelKey: "admin:nav.group.governance" },
] as const satisfies readonly { id: AdminContextGroup; labelKey: string }[];

export const ADMIN_CONTEXT_ROUTES = defineAdminContextRoutes([
  {
    tab: "member",
    group: "people",
    labelKey: "admin:tab.member",
    icon: asNavigationIcon(UsersIcon),
    permissions: ["admin.users.view"],
  },
  {
    tab: "invite",
    group: "people",
    labelKey: "admin:tab.invite",
    icon: asNavigationIcon(LinkIcon),
    permissions: ["admin.invite.view"],
  },
  {
    tab: "roles",
    group: "config",
    labelKey: "admin:tab.roles",
    icon: asNavigationIcon(ShieldIcon),
    permissions: ["admin.roles.view", "admin.roles.manage"],
  },
  {
    tab: "classes",
    group: "config",
    labelKey: "admin:tab.classes",
    icon: asNavigationIcon(SwordIcon),
    permissions: ["admin.classes.manage"],
  },
  {
    tab: "badges",
    group: "config",
    labelKey: "admin:tab.badges",
    icon: asNavigationIcon(TrophyIcon),
    permissions: ["admin.badges.manage"],
  },
  {
    tab: "siteConfig",
    group: "config",
    labelKey: "admin:tab.siteConfig",
    icon: asNavigationIcon(SettingsIcon),
    permissions: ["admin.siteConfig.manage"],
  },
  {
    tab: "importantNotices",
    group: "config",
    labelKey: "admin:tab.importantNotices",
    icon: asNavigationIcon(InfoCircleIcon),
    permissions: ["admin.importantNotices.manage"],
  },
  {
    tab: "operations",
    group: "ops",
    labelKey: "admin:tab.operations",
    icon: asNavigationIcon(HeartbeatIcon),
    permissions: ["admin.status.view"],
  },
  {
    tab: "diagnostics",
    group: "ops",
    labelKey: "admin:tab.diagnostics",
    icon: asNavigationIcon(WrenchIcon),
    permissions: ["admin.status.view"],
  },
  {
    tab: "audit",
    group: "governance",
    labelKey: "admin:tab.audit",
    icon: asNavigationIcon(FileSearchIcon),
    permissions: ["admin.audit.view"],
  },
] as const);

export type AdminContextTab = (typeof ADMIN_CONTEXT_ROUTES)[number]["tab"];
export type AdminContextRouteMetadata = (typeof ADMIN_CONTEXT_ROUTES)[number];

export function isAdminContextTab(value: string | undefined): value is AdminContextTab {
  return ADMIN_CONTEXT_ROUTES.some((route) => route.tab === value);
}

export function resolveAdminContextTab(value: string | undefined): AdminContextTab {
  return isAdminContextTab(value) ? value : "member";
}

export function findAdminContextRoute(tab: AdminContextTab): AdminContextRouteMetadata {
  return ADMIN_CONTEXT_ROUTES.find((route) => route.tab === tab) ?? ADMIN_CONTEXT_ROUTES[0];
}

export function isAdminContextRouteVisible(
  route: AdminContextRouteMetadata,
  canManage: (permissions: Permission[]) => boolean,
): boolean {
  return canManage([...route.permissions]);
}

export function groupAdminContextRoutes(routes: readonly AdminContextRouteMetadata[]) {
  return ADMIN_CONTEXT_NAV_GROUPS.map((group) => ({
    ...group,
    routes: routes.filter((route) => route.group === group.id),
  })).filter((group) => group.routes.length > 0);
}
