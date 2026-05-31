import { type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface LampHeadingProps {
  children: ReactNode;
  className?: string;
  coneWidth?: number;
  coneHeight?: number;
  animated?: boolean;
}

export function LampHeading({
  children,
  className,
  coneWidth = 320,
  coneHeight = 140,
  animated = false,
}: LampHeadingProps) {
  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      <div
        className={cn(
          "absolute rounded-full bg-blue-500/20 blur-3xl dark:bg-blue-400/10",
          animated && "animate-pulse",
        )}
        style={{
          width: coneWidth,
          height: coneHeight,
          top: -(coneHeight / 2),
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
