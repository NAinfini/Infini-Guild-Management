import type { FeatureFlags } from "@guild/shared";
import type { IconProps } from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { NotificationFeature } from "../../stores/notifications";
import {
  BookOutlined,
  CalendarOutlined,
  DashboardOutlined,
  NotificationOutlined,
  PictureOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UserOutlined,
  WarehouseOutlined,
} from "../../utils/icons";

export type PortalRouteGroup =
  | "overview"
  | "community"
  | "operations"
  | "personal"
  | "administration";

export type PortalContentWidth = "reading" | "standard" | "wide" | "workbench";

export type PortalRouteMetadata = {
  to: string;
  labelKey: string;
  group: PortalRouteGroup;
  icon: ComponentType<IconProps>;
  contentWidth: PortalContentWidth;
  mobilePrimary?: number;
  requiresSession?: boolean;
  requiresModerator?: boolean;
  feature?: NotificationFeature;
  featureFlag?: keyof FeatureFlags;
};

export const PORTAL_NAV_GROUPS = [
  { id: "overview", labelKey: "nav.group.overview" },
  { id: "community", labelKey: "nav.group.community" },
  { id: "operations", labelKey: "nav.group.operations" },
  { id: "personal", labelKey: "nav.group.personal" },
  { id: "administration", labelKey: "nav.group.administration" },
] as const satisfies readonly { id: PortalRouteGroup; labelKey: string }[];

export const PORTAL_ROUTES: readonly PortalRouteMetadata[] = [
  {
    to: "/",
    labelKey: "nav.dashboard",
    group: "overview",
    icon: DashboardOutlined,
    contentWidth: "wide",
    mobilePrimary: 1,
  },
  {
    to: "/announcements",
    labelKey: "nav.announcements",
    group: "community",
    icon: NotificationOutlined,
    contentWidth: "wide",
    feature: "announcements",
    featureFlag: "announcements",
  },
  {
    to: "/events",
    labelKey: "nav.events",
    group: "community",
    icon: CalendarOutlined,
    contentWidth: "standard",
    mobilePrimary: 2,
    featureFlag: "events",
  },
  {
    to: "/roster",
    labelKey: "nav.roster",
    group: "community",
    icon: TeamOutlined,
    contentWidth: "wide",
    mobilePrimary: 4,
    feature: "members",
  },
  {
    to: "/gallery",
    labelKey: "nav.gallery",
    group: "community",
    icon: PictureOutlined,
    contentWidth: "wide",
    featureFlag: "gallery",
  },
  {
    to: "/wiki",
    labelKey: "nav.wiki",
    group: "community",
    icon: BookOutlined,
    contentWidth: "wide",
    featureFlag: "wiki",
  },
  {
    to: "/guild-war",
    labelKey: "nav.guild-war",
    group: "operations",
    icon: ThunderboltOutlined,
    contentWidth: "workbench",
    mobilePrimary: 3,
    featureFlag: "guildWar",
  },
  {
    to: "/storage",
    labelKey: "nav.storage",
    group: "operations",
    icon: WarehouseOutlined,
    contentWidth: "workbench",
    requiresSession: true,
    featureFlag: "storage",
  },
  {
    to: "/tools",
    labelKey: "nav.tools",
    group: "operations",
    icon: ToolOutlined,
    contentWidth: "standard",
    featureFlag: "tools",
  },
  {
    to: "/profile",
    labelKey: "nav.profile",
    group: "personal",
    icon: UserOutlined,
    contentWidth: "standard",
    requiresSession: true,
  },
  {
    to: "/settings",
    labelKey: "nav.settings",
    group: "personal",
    icon: SettingOutlined,
    contentWidth: "standard",
  },
  {
    to: "/admin",
    labelKey: "nav.admin",
    group: "administration",
    icon: SettingOutlined,
    contentWidth: "workbench",
    requiresSession: true,
    requiresModerator: true,
  },
];

const NOT_FOUND_ROUTE: PortalRouteMetadata = {
  to: "/__not-found__",
  labelKey: "notFound.title",
  group: "overview",
  icon: DashboardOutlined,
  contentWidth: "reading",
};

export function isPortalPathActive(pathname: string, target: string): boolean {
  return target === "/"
    ? pathname === "/"
    : pathname === target || pathname.startsWith(`${target}/`);
}

export function findPortalRoute(pathname: string): PortalRouteMetadata {
  return (
    [...PORTAL_ROUTES]
      .sort((left, right) => right.to.length - left.to.length)
      .find((route) => isPortalPathActive(pathname, route.to)) ?? NOT_FOUND_ROUTE
  );
}

export function groupPortalRoutes(routes: readonly PortalRouteMetadata[]) {
  return PORTAL_NAV_GROUPS.map((group) => ({
    ...group,
    routes: routes.filter((route) => route.group === group.id),
  })).filter((group) => group.routes.length > 0);
}
