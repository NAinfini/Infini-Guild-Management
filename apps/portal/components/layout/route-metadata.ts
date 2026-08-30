import type { FeatureFlags } from "@guild/shared";
import type { IconProps } from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { VisualPageSceneId } from "../../visual/themes";
import {
  BookOutlined,
  CalendarOutlined,
  DashboardOutlined,
  NotificationOutlined,
  PictureOutlined,
  SettingOutlined,
  ShieldOutlined,
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

/*
 * 站点分区。它与 group 是两件事：group 决定侧栏怎么分组，domain 决定页面用
 * 哪个色相。两者大体重合但不完全——公会战在 group 里属于 operations，配色上
 * 却该是自己的紫罗兰，所以这里单列一个字段，而不是从 group 推导出来再打两个补丁。
 *
 * 九个区，不是十二个。色环在「不占品牌青、离状态色够远、彼此够远」三条约束下
 * 最多塞得进九支可辨的色相（推导见 tokens.css 的域色专用色支那节），所以有两处
 * 合并：仓库与工具同属 ops，我的资料与设置同属 personal。两处都是同组相邻、
 * 且后者本就是前者的配置面，合并读起来是一件事而不是省下来的。
 *
 * 不写 domain 的只剩仪表盘（以及登录、404）：那是「站点本身」，不属于任何内容
 * 分区，正好让用户选的强调色在首屏露出来。
 */
export type PortalDomain =
  | "announce"
  | "ops"
  | "gallery"
  | "event"
  | "wiki"
  | "war"
  | "personal"
  | "admin"
  | "roster";

export type PortalRouteMetadata = {
  to: string;
  labelKey: string;
  group: PortalRouteGroup;
  domain?: PortalDomain;
  icon: ComponentType<IconProps>;
  contentWidth: PortalContentWidth;
  visualScene?: VisualPageSceneId;
  mobilePrimary?: number;
  requiresSession?: boolean;
  requiresModerator?: boolean;
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
    to: "/dashboard",
    labelKey: "nav.dashboard",
    group: "overview",
    icon: DashboardOutlined,
    contentWidth: "wide",
    visualScene: "dashboard",
    mobilePrimary: 1,
  },
  {
    to: "/announcements",
    labelKey: "nav.announcements",
    group: "community",
    domain: "announce",
    icon: NotificationOutlined,
    contentWidth: "wide",
    visualScene: "announcements",
    featureFlag: "announcements",
  },
  {
    to: "/events",
    labelKey: "nav.events",
    group: "community",
    domain: "event",
    icon: CalendarOutlined,
    contentWidth: "standard",
    visualScene: "events",
    mobilePrimary: 2,
    featureFlag: "events",
  },
  {
    to: "/roster",
    labelKey: "nav.roster",
    group: "community",
    domain: "roster",
    icon: TeamOutlined,
    contentWidth: "wide",
    visualScene: "roster",
    mobilePrimary: 4,
  },
  {
    to: "/gallery",
    labelKey: "nav.gallery",
    group: "community",
    domain: "gallery",
    icon: PictureOutlined,
    contentWidth: "wide",
    visualScene: "gallery",
    featureFlag: "gallery",
  },
  {
    to: "/wiki",
    labelKey: "nav.wiki",
    group: "community",
    domain: "wiki",
    icon: BookOutlined,
    contentWidth: "wide",
    visualScene: "wiki",
    featureFlag: "wiki",
  },
  {
    to: "/guild-war",
    labelKey: "nav.guild-war",
    group: "operations",
    domain: "war",
    icon: ThunderboltOutlined,
    contentWidth: "workbench",
    visualScene: "guild-war",
    mobilePrimary: 3,
    featureFlag: "guildWar",
  },
  {
    to: "/storage",
    labelKey: "nav.storage",
    group: "operations",
    domain: "ops",
    icon: WarehouseOutlined,
    contentWidth: "workbench",
    visualScene: "storage",
    requiresSession: true,
    featureFlag: "storage",
  },
  {
    to: "/tools",
    labelKey: "nav.tools",
    group: "operations",
    domain: "ops",
    icon: ToolOutlined,
    contentWidth: "standard",
    visualScene: "tools",
    featureFlag: "tools",
  },
  {
    to: "/profile",
    labelKey: "nav.profile",
    group: "personal",
    domain: "personal",
    icon: UserOutlined,
    contentWidth: "standard",
    visualScene: "profile",
    requiresSession: true,
  },
  {
    to: "/settings",
    labelKey: "nav.settings",
    group: "personal",
    domain: "personal",
    icon: SettingOutlined,
    contentWidth: "standard",
    visualScene: "settings",
  },
  {
    to: "/admin",
    labelKey: "nav.admin",
    group: "administration",
    domain: "admin",
    /* 和「设置」共用齿轮时，折叠成图标轨道后两项完全分不出来。 */
    icon: ShieldOutlined,
    contentWidth: "workbench",
    visualScene: "admin",
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
