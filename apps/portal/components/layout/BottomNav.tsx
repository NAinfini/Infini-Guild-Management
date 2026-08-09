import { Indicator, Menu, UnstyledButton } from "@mantine/core";
import { Link, useNavigate } from "@tanstack/react-router";
import type { IconProps } from "@tabler/icons-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { EllipsisOutlined } from "../../utils/icons";

type BottomNavItem = {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  isNew?: boolean;
};

type BottomNavProps = {
  pathname: string;
  mainItems: BottomNavItem[];
  moreItems: BottomNavItem[];
  onNavigate?: (to: string) => void;
};

function isPathActive(pathname: string, target: string): boolean {
  if (target === "/") {
    return pathname === "/";
  }

  return pathname === target || pathname.startsWith(`${target}/`);
}

export function BottomNav({ pathname, mainItems, moreItems, onNavigate }: BottomNavProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const isMoreActive = moreItems.some((item) => isPathActive(pathname, item.to));

  return (
    <nav aria-label={t("nav.bottomNav")} className="app-bottom-nav">
      <div className="bottom-nav-grid">
        {mainItems.slice(0, 4).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`bottom-nav-link ${isPathActive(pathname, item.to) ? "bottom-nav-link--active" : ""}`}
            onClick={() => onNavigate?.(item.to)}
          >
            <Indicator disabled={!item.isNew} offset={2} size={8} inline>
              <div className="bottom-nav-icon">
                <item.icon />
              </div>
            </Indicator>
            <span className="bottom-nav-label">{item.label}</span>
            <span className="bottom-nav-indicator" />
          </Link>
        ))}

        <Menu width={240} position="top-end">
          <Menu.Target>
            <UnstyledButton
              className={`bottom-nav-more-button ${isMoreActive ? "bottom-nav-more-button--active" : ""}`}
              aria-label={t("nav.openMoreLinks")}
            >
              <EllipsisOutlined className="bottom-nav-more-icon" />
              <span className="bottom-nav-label">{t("nav.more")}</span>
              <span className="bottom-nav-indicator" />
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            {moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <Menu.Item
                  key={item.to}
                  leftSection={
                    <Indicator disabled={!item.isNew} size={7} offset={1} inline>
                      <Icon size={15} />
                    </Indicator>
                  }
                  onClick={() => {
                    onNavigate?.(item.to);
                    void navigate({ to: item.to as never });
                  }}
                >
                  {item.label}
                </Menu.Item>
              );
            })}
          </Menu.Dropdown>
        </Menu>
      </div>
    </nav>
  );
}
