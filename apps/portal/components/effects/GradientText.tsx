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
        !from && !to && "from-blue-500 to-purple-500",
        animated && "bg-[length:200%_100%] animate-[shimmer_linear_infinite]",
        className,
      )}
      style={{
        ...(from || to
          ? { backgroundImage: `linear-gradient(to right, ${from ?? "#3B82F6"}, ${to ?? "#8B5CF6"})` }
          : undefined),
        ...(animated ? { animationDuration: `${duration}s` } : undefined),
      }}
    >
      {children}
    </span>
  );
}
