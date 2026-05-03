import { forwardRef, useCallback, useRef, type MouseEventHandler, type ReactNode } from "react";

export interface PortalCardProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children" | "onClick"> {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
  interactive?: boolean;
  padding?: string | number;
}

export const PortalCard = forwardRef<HTMLDivElement, PortalCardProps>(
  function PortalCard({ children, className, onClick, style, interactive = true, padding, ...rest }, ref) {
    const internalRef = useRef<HTMLDivElement>(null);
    const cardRef = (ref ?? internalRef) as React.RefObject<HTMLDivElement>;

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--spotlight-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--spotlight-y", `${e.clientY - rect.top}px`);
    }, [cardRef]);

    const classes = [
      "portal-card",
      interactive ? "portal-card--interactive" : "",
      onClick ? "portal-card--clickable" : "",
      className,
    ].filter(Boolean).join(" ");

    return (
      <div
        ref={cardRef}
        className={classes}
        onClick={onClick}
        onMouseMove={interactive ? handleMouseMove : undefined}
        style={style}
        {...rest}
      >
        {interactive && <div className="portal-card__spotlight" />}
        <div className="portal-card__inner" style={padding != null ? { padding } : undefined}>{children}</div>
      </div>
    );
  },
);
