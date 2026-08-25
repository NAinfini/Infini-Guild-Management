import { Children, type ReactNode } from "react";

interface StaggerListProps {
  children: ReactNode;
  className?: string;
  staggerMs?: number;
}

export function StaggerList({ children, className, staggerMs = 60 }: StaggerListProps) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column" }}>
      {Children.map(children, (child, i) => (
        <div
          style={{
            animation: "fadeInUp 0.4s ease-out both",
            animationDelay: `${i * staggerMs}ms`,
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
