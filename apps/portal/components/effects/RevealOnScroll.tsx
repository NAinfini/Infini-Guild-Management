import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

const OBSERVER_THRESHOLD = 0.1;
let sharedObserver: IntersectionObserver | null = null;
const callbacks = new Map<Element, () => void>();

function getSharedObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cb = callbacks.get(entry.target);
            if (cb) {
              cb();
              callbacks.delete(entry.target);
              sharedObserver!.unobserve(entry.target);
            }
          }
        }
      },
      { threshold: OBSERVER_THRESHOLD },
    );
  }
  return sharedObserver;
}

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

    const observer = getSharedObserver();
    callbacks.set(el, () => setVisible(true));
    observer.observe(el);
    return () => {
      callbacks.delete(el);
      observer.unobserve(el);
    };
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
