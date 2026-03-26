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
      color: "var(--infini-color-text)",
      borderStyle: "solid",
      borderWidth: "var(--infini-border-width)",
      borderColor: "var(--infini-color-border)",
      borderRadius: "var(--infini-radius)",
      boxShadow: "0 12px 28px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
      cursor: onClick ? "pointer" : undefined,
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
