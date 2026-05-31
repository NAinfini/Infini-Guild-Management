import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface GlassEffectProps {
  children?: ReactNode;
  className?: string;
  blur?: number;
  opacity?: number;
  borderOpacity?: number;
}

export function GlassEffect({
  children,
  className,
  blur = 12,
  opacity = 0.1,
  borderOpacity = 0.2,
}: GlassEffectProps) {
  const style: CSSProperties = {
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    background: `color-mix(in srgb, var(--color-surface, #ffffff) ${Math.round(opacity * 100)}%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--color-surface, #ffffff) ${Math.round(borderOpacity * 100)}%, transparent)`,
  };

  return (
    <div className={cn("rounded-xl shadow-lg", className)} style={style}>
      {children}
    </div>
  );
}
