import { forwardRef, type MouseEventHandler, type ReactNode } from "react";

export interface PortalCardProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children" | "onClick"> {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
  interactive?: boolean;
  padding?: string | number;
}

export const PortalCard = forwardRef<HTMLDivElement, PortalCardProps>(
  function PortalCard({ children, className, onClick, style, interactive = true, padding, ...rest }, ref) {
    const classes = [
      "portal-card",
      interactive ? "portal-card--interactive" : "",
      onClick ? "portal-card--clickable" : "",
      className,
    ].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={classes} onClick={onClick} style={style} {...rest}>
        <div className="portal-card__inner" style={padding != null ? { padding } : undefined}>{children}</div>
      </div>
    );
  },
);
