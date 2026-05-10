import { Paper, Title, type PaperProps } from "@mantine/core";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import "./PageLayout.css";

type PageLayoutProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
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

type PageLayoutCardProps = PaperProps & {
  children?: ReactNode;
  hoverable?: boolean;
  onClick?: () => void;
};

type PageLayoutCompound = ((props: PageLayoutProps) => ReactElement) & {
  Section: (props: PageLayoutSectionProps) => ReactElement;
  Grid: (props: PageLayoutGridProps) => ReactElement;
  Card: (props: PageLayoutCardProps) => ReactElement;
  Divider: () => ReactElement;
};

function PageLayoutRoot({ actions, children, className }: PageLayoutProps) {
  return (
    <div className={`page-layout ${className ?? ""}`.trim()}>
      {actions ? (
        <div className="page-layout__actions-bar">{actions}</div>
      ) : null}
      <div className="page-layout__content">{children}</div>
    </div>
  );
}

function PageLayoutSection({ title, children, className }: PageLayoutSectionProps) {
  return (
    <section className={`page-layout__section ${className ?? ""}`.trim()}>
      {title ? (
        <Title order={2} className="page-layout__section-title">
          {title}
        </Title>
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

function PageLayoutCard({ className, hoverable, ...cardProps }: PageLayoutCardProps) {
  return (
    <Paper
      {...cardProps}
      withBorder
      className={`page-layout__card ${hoverable ? "infini-card-hover" : ""} ${className ?? ""}`.trim()}
    />
  );
}

function PageLayoutDivider() {
  return <div className="page-layout__divider" aria-hidden />;
}

export const PageLayout = PageLayoutRoot as PageLayoutCompound;
PageLayout.Section = PageLayoutSection;
PageLayout.Grid = PageLayoutGrid;
PageLayout.Card = PageLayoutCard;
PageLayout.Divider = PageLayoutDivider;
