import { IconX } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { IconProps } from "@tabler/icons-react";
import { useMemo, useState, type ComponentType, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { EllipsisOutlined } from "../../utils/icons";

type NavigationIcon = ComponentType<IconProps> | ComponentType<{ size?: number }>;

export type BottomNavItem = {
  id?: string;
  to: string;
  label: string;
  icon: NavigationIcon;
  active?: boolean;
  onSelect?: () => void;
  groupLabel?: string;
};

type BottomNavProps = {
  pathname: string;
  mainItems: BottomNavItem[];
  moreItems: BottomNavItem[];
};

function isPathActive(pathname: string, target: string): boolean {
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
}

type BottomNavItemGroup = {
  label?: string;
  items: BottomNavItem[];
};

export function groupBottomNavItems(items: readonly BottomNavItem[]): BottomNavItemGroup[] {
  const groups: BottomNavItemGroup[] = [];
  const groupIndexes = new Map<string, number>();

  for (const item of items) {
    const key = item.groupLabel ?? "";
    const existingIndex = groupIndexes.get(key);
    if (existingIndex !== undefined) {
      groups[existingIndex]?.items.push(item);
      continue;
    }

    groupIndexes.set(key, groups.length);
    groups.push({ label: item.groupLabel, items: [item] });
  }

  return groups;
}

export function BottomNav({ pathname, mainItems, moreItems }: BottomNavProps) {
  const { t } = useTranslation("common");
  const [moreOpened, setMoreOpened] = useState(false);
  const itemIsActive = (item: BottomNavItem) => item.active ?? isPathActive(pathname, item.to);
  const isMoreActive = moreItems.some(itemIsActive);
  const showMore = moreItems.length > 0;
  const groupedMoreItems = useMemo(() => groupBottomNavItems(moreItems), [moreItems]);

  const selectItem = (item: BottomNavItem, event: MouseEvent<HTMLAnchorElement>) => {
    setMoreOpened(false);
    if (item.onSelect) {
      event.preventDefault();
      item.onSelect();
      return;
    }
  };

  return (
    <nav aria-label={t("nav.bottomNav")} className="app-bottom-nav">
      <div className="bottom-nav-grid">
        {mainItems.slice(0, 4).map((item) => (
          <Link
            key={item.id ?? item.to}
            to={item.to}
            className={`bottom-nav-link ${itemIsActive(item) ? "bottom-nav-link--active" : ""}`}
            aria-current={itemIsActive(item) ? "page" : undefined}
            onClick={(event) => {
              if (item.onSelect) {
                event.preventDefault();
                item.onSelect();
                return;
              }
            }}
          >
            <span className="bottom-nav-icon-wrap">
              <span className="bottom-nav-icon"><item.icon /></span>
            </span>
            <span className="bottom-nav-label">{item.label}</span>
            <span className="bottom-nav-indicator" />
          </Link>
        ))}

        {showMore ? (
          <button
            type="button"
            className={`bottom-nav-more-button ${isMoreActive ? "bottom-nav-more-button--active" : ""}`}
            aria-label={t("nav.openMoreLinks")}
            aria-expanded={moreOpened}
            aria-controls="bottom-nav-more-drawer"
            onClick={() => setMoreOpened(true)}
          >
            <EllipsisOutlined className="bottom-nav-more-icon" />
            <span className="bottom-nav-label">{t("nav.more")}</span>
            <span className="bottom-nav-indicator" />
          </button>
        ) : null}
      </div>

      <Drawer open={moreOpened} onOpenChange={(open) => setMoreOpened(open)} swipeDirection="down">
        <DrawerContent id="bottom-nav-more-drawer" className="bottom-nav-drawer__content">
          <DrawerHeader className="bottom-nav-drawer__header">
            <DrawerTitle className="bottom-nav-drawer__title">{t("nav.more")}</DrawerTitle>
            <DrawerClose
              aria-label={t("action.close")}
              render={<button type="button" className="bottom-nav-drawer__close" />}
            >
              <IconX aria-hidden="true" />
            </DrawerClose>
          </DrawerHeader>

          <ScrollArea className="bottom-nav-drawer__body">
            <div className="bottom-nav-drawer__groups">
              {groupedMoreItems.map((group, groupIndex) => (
                <section
                  key={group.label ?? `ungrouped-${groupIndex}`}
                  className="bottom-nav-drawer__group"
                  aria-label={group.label}
                >
                  {group.label ? <h2 className="bottom-nav-drawer__group-title">{group.label}</h2> : null}
                  <div className="bottom-nav-drawer__links">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = itemIsActive(item);
                      return (
                        <Link
                          key={item.id ?? item.to}
                          to={item.to}
                          className={`bottom-nav-drawer__link${active ? " bottom-nav-drawer__link--active" : ""}`}
                          aria-current={active ? "page" : undefined}
                          onClick={(event) => selectItem(item, event)}
                        >
                          <span className="bottom-nav-drawer__link-icon-wrap">
                            <span className="bottom-nav-drawer__link-icon"><Icon size={20} /></span>
                          </span>
                          <span className="bottom-nav-drawer__link-label">{item.label}</span>
                          <span className="bottom-nav-drawer__link-status" aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
