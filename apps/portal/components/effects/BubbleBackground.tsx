import { useMemo, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface BubbleBackgroundProps {
  children?: ReactNode;
  className?: string;
  count?: number;
  minSize?: number;
  maxSize?: number;
  speed?: number;
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export function BubbleBackground({
  children,
  className,
  count = 3,
  minSize = 36,
  maxSize = 56,
  speed = 1,
}: BubbleBackgroundProps) {
  const bubbles = useMemo(() => {
    const rng = seededRandom(42);
    return Array.from({ length: count }, (_, i) => {
      const size = minSize + rng() * (maxSize - minSize);
      const left = rng() * 100;
      const top = rng() * 100;
      const duration = (6 + rng() * 6) / speed;
      const delay = rng() * 4;
      const hue = 200 + rng() * 60;
      return { id: i, size, left, top, duration, delay, hue };
    });
  }, [count, minSize, maxSize, speed]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div className="pointer-events-none absolute inset-0">
        {bubbles.map((b) => (
          <div
            key={b.id}
            className="absolute rounded-full blur-2xl"
            style={{
              width: b.size,
              height: b.size,
              left: `${b.left}%`,
              top: `${b.top}%`,
              background: `hsla(${b.hue}, 60%, 60%, 0.1)`,
              animation: `float ${b.duration}s ease-in-out ${b.delay}s infinite`,
            }}
          />
        ))}
      </div>
      {children && <div className="relative z-10">{children}</div>}
    </div>
  );
}
