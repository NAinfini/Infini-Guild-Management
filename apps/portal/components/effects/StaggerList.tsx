import { Children, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

interface StaggerListProps {
  children: ReactNode;
  className?: string;
  staggerMs?: number;
}

export function StaggerList({ children, className, staggerMs = 60 }: StaggerListProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      {Children.map(children, (child, i) => (
        <div
          className="animate-[fadeInUp_0.4s_ease-out_both]"
          style={{ animationDelay: `${i * staggerMs}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
