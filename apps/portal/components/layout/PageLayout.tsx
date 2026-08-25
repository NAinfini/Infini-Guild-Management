import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./PageLayout.css";

type PageLayoutProps = {
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  children: ReactNode;
  className?: string;
  toolbar?: ReactNode;
  workspaceMode?: "scroll" | "contained";
};

type PageLayoutSectionProps = {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
};

type GridCols = {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
};

type PageLayoutGridProps = {
  cols?: GridCols;
  gap?: number | string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

type PageLayoutCompound = ((props: PageLayoutProps) => ReactElement) & {
  Section: (props: PageLayoutSectionProps) => ReactElement;
  Grid: (props: PageLayoutGridProps) => ReactElement;
  Divider: () => ReactElement;
};

function PageLayoutRoot({
  actions,
  breadcrumbs,
  children,
  className,
  toolbar,
  workspaceMode = "scroll",
}: PageLayoutProps) {
  const { t } = useTranslation("common");
  const hasHeader = Boolean(actions || breadcrumbs);

  return (
    <div
      className={`page-layout ${className ?? ""}`.trim()}
      data-page-layout="content"
      data-workspace-mode={workspaceMode}
    >
      <div className="page-layout__content">
        {hasHeader ? (
          <div className="page-layout__action-row">
            {breadcrumbs ? (
              <nav className="page-layout__breadcrumbs" aria-label={t("nav.breadcrumbs")}>
                {breadcrumbs}
              </nav>
            ) : null}

            {actions ? <div className="page-layout__primary-action">{actions}</div> : null}
          </div>
        ) : null}
        {toolbar ? <div className="page-layout__toolbar">{toolbar}</div> : null}
        <div className="page-layout__workspace">{children}</div>
      </div>
    </div>
  );
}

function PageLayoutSection({ title, children, className }: PageLayoutSectionProps) {
  return (
    <section className={`page-layout__section ${className ?? ""}`.trim()}>
      {title ? (
        <h2 className="page-layout__section-title">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

function PageLayoutGrid({
  cols = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 },
  gap = 12,
  children,
  className,
  style,
}: PageLayoutGridProps) {
  const mergedStyle: CSSProperties = {
    ...style,
    ["--page-layout-cols-xs" as string]: cols.xs ?? 1,
    ["--page-layout-cols-sm" as string]: cols.sm ?? cols.xs ?? 1,
    ["--page-layout-cols-md" as string]: cols.md ?? cols.sm ?? cols.xs ?? 1,
    ["--page-layout-cols-lg" as string]: cols.lg ?? cols.md ?? cols.sm ?? cols.xs ?? 1,
    ["--page-layout-cols-xl" as string]: cols.xl ?? cols.lg ?? cols.md ?? cols.sm ?? cols.xs ?? 1,
    ["--page-layout-grid-gap" as string]: typeof gap === "number" ? `${gap}px` : gap,
  };

  return (
    <div className={`page-layout__grid ${className ?? ""}`.trim()} style={mergedStyle}>
      {children}
    </div>
  );
}

function PageLayoutDivider() {
  return <div className="page-layout__divider" aria-hidden />;
}

export const PageLayout = PageLayoutRoot as PageLayoutCompound;
PageLayout.Section = PageLayoutSection;
PageLayout.Grid = PageLayoutGrid;
PageLayout.Divider = PageLayoutDivider;
