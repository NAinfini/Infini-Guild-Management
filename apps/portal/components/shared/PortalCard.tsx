import { forwardRef, type CSSProperties, type MouseEventHandler, type ReactNode } from "react";

export interface PortalCardProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children" | "onClick"> {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
  interactive?: boolean;
  padding?: string | number;
}

export const PortalCard = forwardRef<HTMLDivElement, PortalCardProps>(
  function PortalCard({ children, className, onClick, style, interactive = true, padding, ...rest }, ref) {
    const baseStyle: CSSProperties = {
      position: "relative",
      overflow: "hidden",
      color: "var(--color-text)",
      borderStyle: "solid",
      borderWidth: "1px",
      borderColor: "color-mix(in srgb, var(--color-border) 80%, transparent)",
      borderRadius: "12px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.04)",
      background: "var(--color-surface, #ffffff)",
      cursor: onClick ? "pointer" : undefined,
      transition: interactive ? "box-shadow 180ms ease, transform 180ms ease" : undefined,
      ...style,
    };

    const classes = ["portal-card", className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={classes} onClick={onClick} style={baseStyle} {...rest}>
        <div style={{ position: "relative", zIndex: 2, padding }}>{children}</div>
      </div>
    );
  },
);
