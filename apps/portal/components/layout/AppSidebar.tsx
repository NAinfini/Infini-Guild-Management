import type { AdminRole } from "@guild/shared";
import type { IconProps } from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { useSiteConfigStore } from "../../stores/site-config";
import { LeftOutlined, RightOutlined } from "../../utils/icons";
import { VisualThemeScene } from "../shared/VisualThemeArtwork";
import { ViewingAsSelector } from "./ViewingAsSelector";

export const SIDEBAR_WIDTH = 236;
export const SIDEBAR_COLLAPSED_WIDTH = 84;
export const MOBILE_BREAKPOINT_PX = 767;
export const COMPACT_NAV_BREAKPOINT_PX = 1023;
export const HEADER_COMPACT_BREAKPOINT_PX = COMPACT_NAV_BREAKPOINT_PX;

export type SidebarNavigationItem = {
  id: string;
  labelKey: string;
  icon: ComponentType<IconProps>;
  rightSection?: ReactNode;
};

export type SidebarNavigationGroup = {
  id: string;
  labelKey: string;
  routes: readonly SidebarNavigationItem[];
};

type AppSidebarProps = {
  isSidebarCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  navGroups: readonly SidebarNavigationGroup[];
  selectedNavKey: string;
  onNavigate: (item: SidebarNavigationItem) => void;
  onReturnToPortal?: () => void;
  canSwitchView: boolean;
  viewingAs: string;
  roles: AdminRole[];
  onViewingAsChange: (nextRole: string) => void;
};

export function AppSidebar({
  isSidebarCollapsed,
  onCollapse,
  onExpand,
  navGroups,
  selectedNavKey,
  onNavigate,
  onReturnToPortal,
  canSwitchView,
  viewingAs,
  roles,
  onViewingAsChange,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const siteName = useSiteConfigStore((state) => state.siteName);
  const siteLogoUrl = useSiteConfigStore((state) => state.siteLogoUrl);
  const brandMark = siteLogoUrl ? (
    <img src={siteLogoUrl} alt="" className="app-brand-logo" />
  ) : (
    <span aria-hidden>{siteName.slice(0, 1).toUpperCase()}</span>
  );

  return (
    <aside
      className={`app-sider ${isSidebarCollapsed ? "app-sider--collapsed" : ""}`}
      aria-label={siteName}
    >
      <VisualThemeScene
        variant="navigation"
        className="app-sider__scene"
      />

      <div className="app-brand">
        {isSidebarCollapsed ? (
          <button
            type="button"
            className="app-brand-mark app-brand-mark--button"
            aria-label={t("nav.expandSidebar")}
            onClick={onExpand}
          >
            <span className="app-brand-mark__identity">{brandMark}</span>
            <span className="app-brand-mark__expand-icon" aria-hidden="true">
              <RightOutlined size={18} />
            </span>
          </button>
        ) : (
          <>
            <div className="app-brand-main">
              <div className="app-brand-mark">{brandMark}</div>
              <Tooltip>
                <TooltipTrigger render={<span className="app-brand-title" />}>
                  {siteName}
                </TooltipTrigger>
                <TooltipContent side="right">{siteName}</TooltipContent>
              </Tooltip>
            </div>
            <button
              type="button"
              className="app-sider-control-btn"
              aria-label={t("nav.collapseSidebar")}
              onClick={onCollapse}
            >
              <LeftOutlined size={18} />
            </button>
          </>
        )}
      </div>

      <ScrollArea className="app-sider-menu">
        <nav className="app-nav-groups">
          {onReturnToPortal ? (
            <button
              type="button"
              className="app-context-return"
              aria-label={t("nav.returnToPortal")}
              onClick={onReturnToPortal}
            >
              <LeftOutlined size={18} />
              {!isSidebarCollapsed ? <span>{t("nav.returnToPortal")}</span> : null}
            </button>
          ) : null}

          {navGroups.map((group, groupIndex) => (
            <section key={group.id} className="app-nav-group">
              {groupIndex > 0 && isSidebarCollapsed ? (
                <div className="app-nav-group-divider" aria-hidden="true" />
              ) : null}
              {!isSidebarCollapsed ? (
                <h2 className="app-nav-section-label">{t(group.labelKey)}</h2>
              ) : null}
              <div className="app-nav-items">
                {group.routes.map((item) => {
                  const Icon = item.icon;
                  const label = t(item.labelKey);
                  const active = item.id === selectedNavKey;

                  return (
                    <Tooltip key={item.id} disabled={!isSidebarCollapsed}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="app-nav-item"
                            data-active={active || undefined}
                            aria-label={label}
                            aria-current={active ? "page" : undefined}
                            onClick={() => onNavigate(item)}
                          />
                        }
                      >
                        <span className="app-nav-icon-wrap">
                          <span className="app-nav-icon"><Icon size={18} /></span>
                        </span>
                        {!isSidebarCollapsed ? <span className="app-nav-item__label">{label}</span> : null}
                        {!isSidebarCollapsed && item.rightSection ? (
                          <span className="app-nav-item__meta">{item.rightSection}</span>
                        ) : null}
                      </TooltipTrigger>
                      <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </ScrollArea>

      {canSwitchView ? (
        <ViewingAsSelector
          value={viewingAs}
          compact={isSidebarCollapsed}
          roles={roles}
          onChange={onViewingAsChange}
        />
      ) : null}
    </aside>
  );
}
