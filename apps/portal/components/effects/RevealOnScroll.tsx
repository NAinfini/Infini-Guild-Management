import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

export interface RevealOnScrollProps {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}

export function RevealOnScroll({ children, className, delayMs = 0 }: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties = delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : {};

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-500 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
