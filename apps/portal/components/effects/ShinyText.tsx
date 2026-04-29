import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface ShinyTextProps {
  children: ReactNode;
  className?: string;
  duration?: number;
  style?: CSSProperties;
}

export function ShinyText({ children, className, duration = 2, style }: ShinyTextProps) {
  return (
    <span
      className={cn(
        "relative inline-block bg-clip-text text-transparent bg-[length:200%_100%] animate-[shimmer_linear_infinite]",
        "bg-gradient-to-r from-gray-700 via-gray-300 to-gray-700 dark:from-gray-300 dark:via-white dark:to-gray-300",
        className,
      )}
      style={{ animationDuration: `${duration}s`, ...style }}
    >
      {children}
    </span>
  );
}
