import type { ReactNode } from "react";
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
};

function joinClassNames(...parts: Array<string | undefined>): string | undefined {
  const className = parts.filter(Boolean).join(" ");
  return className.length > 0 ? className : undefined;
}

export function FilterToolbar({
  children,
  className,
  contentClassName,
  active = false,
  primary,
  filters,
  viewControls,
  actions,
}: FilterToolbarProps) {
  if (children) {
    return (
      <PortalCard className={className} interactive={false}>
        <div className={joinClassNames("filter-toolbar", active ? "filter-toolbar--active" : undefined)}>
          <div className={joinClassNames("filter-toolbar__content", contentClassName)}>{children}</div>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard className={className} interactive={false}>
      <div className={joinClassNames("filter-toolbar", active ? "filter-toolbar--active" : undefined)}>
        <div className={joinClassNames("filter-toolbar__content", contentClassName)}>
          {primary ? <div className="filter-toolbar__primary">{primary}</div> : null}
          {filters ? <div className="filter-toolbar__filters">{filters}</div> : null}
          {viewControls ? <div className="filter-toolbar__view">{viewControls}</div> : null}
          {actions ? <div className="filter-toolbar__actions">{actions}</div> : null}
        </div>
      </div>
    </PortalCard>
  );
}

