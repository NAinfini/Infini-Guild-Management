import { type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface GradientTextProps {
  children: ReactNode;
  className?: string;
  from?: string;
  to?: string;
  animated?: boolean;
  duration?: number;
}

export function GradientText({
  children,
  className,
  from,
  to,
  animated = false,
  duration = 3,
}: GradientTextProps) {
  return (
    <span
      className={cn(
        "bg-clip-text text-transparent bg-gradient-to-r",
        !from && !to && "from-amber-500 to-yellow-700",
        animated && "bg-[length:200%_100%] animate-[shimmer_linear_infinite]",
        className,
      )}
      style={{
        ...(from || to
          ? { backgroundImage: `linear-gradient(to right, ${from ?? "var(--accent-fill)"}, ${to ?? "var(--accent-fill-hover)"})` }
          : undefined),
        ...(animated ? { animationDuration: `${duration}s` } : undefined),
      }}
    >
      {children}
    </span>
  );
}
