import { type ReactNode, type CSSProperties } from "react";
import { cn } from "@portal/utils/cn";

export interface StarBorderProps {
  children: ReactNode;
  className?: string;
  color?: string;
  speed?: string;
  borderWidth?: number;
}

export function StarBorder({
  children,
  className,
  color = "var(--color-primary, #3b82f6)",
  speed = "6s",
  borderWidth = 1,
}: StarBorderProps) {
  const style = {
    "--star-border-color": color,
    "--star-border-speed": speed,
    "--star-border-width": `${borderWidth}px`,
  } as CSSProperties;

  return (
    <div className={cn("star-border", className)} style={style}>
      <div className="star-border__track" />
      <div className="star-border__inner">{children}</div>
    </div>
  );
}
