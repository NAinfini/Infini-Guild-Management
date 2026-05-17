import { type ReactNode, useState, useEffect } from "react";
import { ActionIcon, Collapse, Group, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { PortalCard } from "./PortalCard";
import "./FilterToolbar.css";

type FilterToolbarProps = {
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  active?: boolean;
  primary?: ReactNode;
  filters?: ReactNode;
  viewControls?: ReactNode;
  actions?: ReactNode;
  resultCount?: string;
};

export function FilterToolbar({
  children,
  className,
  contentClassName,
  active = false,
  primary,
  filters,
  viewControls,
  actions,
  resultCount,
}: FilterToolbarProps) {
  const { t } = useTranslation("common");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (children) {
    return (
      <PortalCard className={className} interactive={false}>
        <div className={clsx("filter-toolbar", active ? "filter-toolbar--active" : undefined)}>
          <div className={clsx("filter-toolbar__content", contentClassName)}>{children}</div>
        </div>
      </PortalCard>
    );
  }

  if (isMobile) {
    return (
      <PortalCard className={className} interactive={false}>
        <div className={clsx("filter-toolbar", active ? "filter-toolbar--active" : undefined)}>
          <Group gap="xs" wrap="nowrap" align="center" className="filter-toolbar__mobile-row">
            {primary ? <div className="filter-toolbar__primary filter-toolbar__primary--mobile">{primary}</div> : null}
            <ActionIcon
              variant={filtersOpen ? "filled" : "default"}
              size="lg"
              onClick={toggleFilters}
              aria-label={t("filter.toggle")}
            >
              <IconAdjustmentsHorizontal size={18} />
            </ActionIcon>
            {resultCount ? (
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {resultCount}
              </Text>
            ) : null}
          </Group>
          <Collapse in={filtersOpen}>
            <div className={clsx("filter-toolbar__collapse", contentClassName)}>
              {filters ? <div className="filter-toolbar__filters">{filters}</div> : null}
              {viewControls ? <div className="filter-toolbar__view">{viewControls}</div> : null}
              {actions ? <div className="filter-toolbar__actions">{actions}</div> : null}
            </div>
          </Collapse>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard className={className} interactive={false}>
      <div className={clsx("filter-toolbar", active ? "filter-toolbar--active" : undefined)}>
        <div className={clsx("filter-toolbar__content", contentClassName)}>
          {primary ? <div className="filter-toolbar__primary">{primary}</div> : null}
          {filters ? <div className="filter-toolbar__filters">{filters}</div> : null}
          {viewControls ? <div className="filter-toolbar__view">{viewControls}</div> : null}
          {actions ? <div className="filter-toolbar__actions">{actions}</div> : null}
        </div>
      </div>
    </PortalCard>
  );
}
