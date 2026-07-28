import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface GlassEffectProps {
  children?: ReactNode;
  className?: string;
  blur?: number;
  opacity?: number;
  borderOpacity?: number;
}

/*
 * The glass look itself lives in the `.glass-effect` rule in styles.css and reads
 * three custom properties. The props below only *set* those properties, and only
 * when given: an inline background outranks every stylesheet, which is what made
 * the auth cards impossible to re-tint per theme. Callers that need a
 * theme-dependent glass set the variables from CSS instead of passing props.
 */
export function GlassEffect({
  children,
  className,
  blur,
  opacity,
  borderOpacity,
}: GlassEffectProps) {
  const style = {
    ...(blur === undefined ? null : { "--glass-blur": `${blur}px` }),
    ...(opacity === undefined ? null : { "--glass-opacity": `${Math.round(opacity * 100)}%` }),
    ...(borderOpacity === undefined ? null : { "--glass-border-opacity": `${Math.round(borderOpacity * 100)}%` }),
  } as CSSProperties;

  return (
    <div className={cn("glass-effect rounded-xl shadow-lg", className)} style={style}>
      {children}
    </div>
  );
}
