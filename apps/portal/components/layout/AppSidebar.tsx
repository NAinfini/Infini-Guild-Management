import type { AdminRole, FeatureFlags } from "@guild/shared";
import {
  BookOutlined,
  CalendarOutlined,
  DashboardOutlined,
  LeftOutlined,
  NotificationOutlined,
  PictureOutlined,
  RightOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WarehouseOutlined,
} from "../../utils/icons";
import { useSiteConfigStore } from "../../stores/site-config";
import type { IconProps } from "@tabler/icons-react";
import {
  ActionIcon,
  AppShell as MantineAppShell,
  Group,
  Indicator,
  ScrollArea,
  Stack,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { type CSSProperties, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NotificationFeature } from "../../stores/notifications";
import { ViewingAsSelector } from "./ViewingAsSelector";

export type NavItem = {
  to: string;
  labelKey: string;
  icon: ComponentType<IconProps>;
  requiresSession?: boolean;
  requiresModerator?: boolean;
  feature?: NotificationFeature;
  featureFlag?: keyof FeatureFlags;
};

export const SIDEBAR_WIDTH = 236;
export const SIDEBAR_COLLAPSED_WIDTH = 56;

// 移动端外壳的断点上限：宽度 <= 此值走移动端布局（顶栏 + 底部导航），> 此值走桌面
// 侧栏。AppShell 同时用它驱动 useMediaQuery 和 Mantine AppShell 的
// navbar.breakpoint，两者必须一致：Mantine 在 max-width 命中 navbar.breakpoint 时
// 会把 navbar 切成 --app-shell-navbar-width: 100% / --app-shell-navbar-offset: 0，
// 若该断点比这里大，中间那段宽度会渲染出铺满整屏、盖住主内容的侧栏。
export const MOBILE_BREAKPOINT_PX = 767;

// 表头工具组进入紧凑态（搜索条折叠成图标）的宽度上限。桌面表头是三列
// grid，第三列按内容定宽且不收缩：完整搜索条会让右列达到约 398px，在 768px
// 视口下（侧栏已占 236px）只剩约 70px 留给标题，页面标题被省略号截成一两个字母。
// 折叠后右列约 278px，标题可得约 190px。
export const HEADER_COMPACT_BREAKPOINT_PX = 1023;

export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: DashboardOutlined },
  { to: "/announcements", labelKey: "nav.announcements", icon: NotificationOutlined, feature: "announcements", featureFlag: "announcements" },
  { to: "/roster", labelKey: "nav.roster", icon: TeamOutlined, feature: "members" },
  { to: "/events", labelKey: "nav.events", icon: CalendarOutlined, featureFlag: "events" },
  { to: "/guild-war", labelKey: "nav.guild-war", icon: ThunderboltOutlined, featureFlag: "guildWar" },
  { to: "/gallery", labelKey: "nav.gallery", icon: PictureOutlined, featureFlag: "gallery" },
  // `/storage` lives under the authenticated-only route, so a guest clicking it
  // only ever lands on the login page — hide it instead of offering a dead end.
  { to: "/storage", labelKey: "nav.storage", icon: WarehouseOutlined, requiresSession: true, featureFlag: "storage" },
  { to: "/wiki", labelKey: "nav.wiki", icon: BookOutlined, featureFlag: "wiki" },
  { to: "/tools", labelKey: "nav.tools", icon: ToolOutlined, featureFlag: "tools" },
  {
    to: "/admin",
    labelKey: "nav.admin",
    icon: SettingOutlined,
    requiresSession: true,
    requiresModerator: true,
  },
];

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

type AppSidebarProps = {
  isSidebarCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  visibleNavItems: NavItem[];
  selectedNavKey: string;
  navHasNew: (item: NavItem) => boolean;
  onNavigate: (to: string) => void;
  canSwitchView: boolean;
  viewingAs: string;
  roles: AdminRole[];
  onViewingAsChange: (nextRole: string) => void;
};

export function AppSidebar({
  isSidebarCollapsed,
  onCollapse,
  onExpand,
  visibleNavItems,
  selectedNavKey,
  navHasNew,
  onNavigate,
  canSwitchView,
  viewingAs,
  roles,
  onViewingAsChange,
}: AppSidebarProps) {
  const { t } = useTranslation("common");
  const siteName = useSiteConfigStore((s) => s.siteName);
  const siteLogoUrl = useSiteConfigStore((s) => s.siteLogoUrl);
  return (
    <MantineAppShell.Navbar
      className={`app-sider ${isSidebarCollapsed ? "app-sider--collapsed" : ""}`}
    >
      <div className="app-brand">
        <div className="app-brand-main">
          <div
            className={`app-brand-mark ${isSidebarCollapsed ? "app-brand-mark--has-expand" : ""}`}
            style={{ position: "relative" }}
          >
            {siteLogoUrl ? (
              <img src={siteLogoUrl} alt="" className="app-brand-logo" />
            ) : null}
            <SidebarExpandOverlay
              collapsed={isSidebarCollapsed}
              onExpand={onExpand}
              className="app-brand-expand-overlay"
            >
              <RightOutlined />
            </SidebarExpandOverlay>
          </div>
          <SidebarLabel collapsed={isSidebarCollapsed} className="app-brand-title-wrap">
            <Tooltip label={siteName} position="right" withArrow openDelay={400}>
              {/*
                * Not a heading: the site name is nav chrome, and as an <h2> it sat
                * before the page's <h1> in document order, which broke heading order
                * on every page.
                */}
              <Title order={2} component="div" className="app-brand-title">
                {siteName}
              </Title>
            </Tooltip>
          </SidebarLabel>
        </div>
        {!isSidebarCollapsed ? (
          <div className="app-sider-controls">
            <ActionIcon
              variant="subtle"
              className="app-sider-control-btn"
              aria-label={t("nav.collapseSidebar")}
              onClick={onCollapse}
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
              <Tooltip key={item.to} label={t(item.labelKey)} disabled={!isSidebarCollapsed} position="right" withArrow>
                <UnstyledButton
                  className={`app-nav-item ${active ? "app-nav-item--active" : ""}`}
                  onClick={() => onNavigate(item.to)}
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
              </Tooltip>
            );
          })}
        </Stack>
      </ScrollArea>

      {canSwitchView ? (
        <ViewingAsSelector
          value={viewingAs}
          compact={isSidebarCollapsed}
          roles={roles}
          onChange={onViewingAsChange}
        />
      ) : null}
    </MantineAppShell.Navbar>
  );
}
