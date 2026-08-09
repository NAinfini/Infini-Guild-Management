import type { AdminRole } from "@guild/shared";
import {
  ActionIcon,
  AppShell as MantineAppShell,
  Box,
  Divider,
  Group,
  Indicator,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useSiteConfigStore } from "../../stores/site-config";
import { LeftOutlined, RightOutlined } from "../../utils/icons";
import {
  groupPortalRoutes,
  type PortalRouteMetadata,
} from "./route-metadata";
import { ViewingAsSelector } from "./ViewingAsSelector";

export const SIDEBAR_WIDTH = 236;
export const SIDEBAR_COLLAPSED_WIDTH = 84;
export const MOBILE_BREAKPOINT_PX = 767;
export const COMPACT_NAV_BREAKPOINT_PX = 1023;
export const HEADER_COMPACT_BREAKPOINT_PX = COMPACT_NAV_BREAKPOINT_PX;

type AppSidebarProps = {
  isSidebarCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  visibleNavItems: readonly PortalRouteMetadata[];
  selectedNavKey: string;
  navHasNew: (item: PortalRouteMetadata) => boolean;
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
  const siteName = useSiteConfigStore((state) => state.siteName);
  const siteLogoUrl = useSiteConfigStore((state) => state.siteLogoUrl);
  const groups = groupPortalRoutes(visibleNavItems);

  const brandMark = siteLogoUrl ? (
    <img src={siteLogoUrl} alt="" className="app-brand-logo" />
  ) : (
    <span aria-hidden>{siteName.slice(0, 1).toUpperCase()}</span>
  );

  return (
    <MantineAppShell.Navbar
      className={`app-sider ${isSidebarCollapsed ? "app-sider--collapsed" : ""}`}
    >
      <Group className="app-brand" justify="space-between" wrap="nowrap">
        {isSidebarCollapsed ? (
          <Tooltip label={t("nav.expandSidebar")} position="right" withArrow>
            <ActionIcon
              variant="subtle"
              size={40}
              className="app-brand-mark app-brand-mark--button"
              aria-label={t("nav.expandSidebar")}
              onClick={onExpand}
            >
              {siteLogoUrl ? brandMark : <RightOutlined />}
            </ActionIcon>
          </Tooltip>
        ) : (
          <>
            <Group gap="sm" wrap="nowrap" className="app-brand-main">
              <Box className="app-brand-mark">{brandMark}</Box>
              <Tooltip label={siteName} position="right" withArrow openDelay={400}>
                <Title order={2} component="div" className="app-brand-title">
                  {siteName}
                </Title>
              </Tooltip>
            </Group>
            <ActionIcon
              variant="subtle"
              className="app-sider-control-btn"
              aria-label={t("nav.collapseSidebar")}
              onClick={onCollapse}
            >
              <LeftOutlined />
            </ActionIcon>
          </>
        )}
      </Group>

      <ScrollArea className="app-sider-menu" type="scroll" scrollbarSize={6}>
        <Stack gap="lg" className="app-nav-groups">
          {groups.map((group, groupIndex) => (
            <Box key={group.id} className="app-nav-group">
              {groupIndex > 0 && isSidebarCollapsed ? (
                <Divider className="app-nav-group-divider" />
              ) : null}
              {!isSidebarCollapsed ? (
                <Text className="app-nav-section-label">
                  {t(group.labelKey)}
                </Text>
              ) : null}
              <Stack gap={4}>
                {group.routes.map((item) => {
                  const Icon = item.icon;
                  const label = t(item.labelKey);
                  return (
                    <Tooltip
                      key={item.to}
                      label={label}
                      disabled={!isSidebarCollapsed}
                      position="right"
                      withArrow
                    >
                      <NavLink
                        component="button"
                        type="button"
                        active={item.to === selectedNavKey}
                        className="app-nav-item"
                        label={isSidebarCollapsed ? undefined : label}
                        aria-label={label}
                        leftSection={
                          <Indicator disabled={!navHasNew(item)} offset={2} size={7} inline>
                            <span className="app-nav-icon">
                              <Icon />
                            </span>
                          </Indicator>
                        }
                        onClick={() => onNavigate(item.to)}
                      />
                    </Tooltip>
                  );
                })}
              </Stack>
            </Box>
          ))}
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
