import { type RefObject, useEffect, useState } from "react";
import { cn } from "@portal/utils/cn";

export interface ScrollProgressProps {
  className?: string;
  thicknessPx?: number;
  zIndex?: number;
  container?: RefObject<HTMLElement | null>;
}

export function ScrollProgress({
  className,
  thicknessPx = 2,
  zIndex = 50,
  container,
}: ScrollProgressProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const target = container?.current ?? null;
    const update = () => {
      if (target) {
        const scrollTop = target.scrollTop;
        const scrollHeight = target.scrollHeight - target.clientHeight;
        setProgress(scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0);
      } else {
        const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        const scrollHeight =
          document.documentElement.scrollHeight - document.documentElement.clientHeight;
        setProgress(scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0);
      }
    };
    const el = target ?? window;
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [container]);

  return (
    <div
      className={cn("fixed top-0 left-0 bg-blue-500 transition-[width] duration-100", className)}
      style={{ width: `${progress}%`, height: thicknessPx, zIndex }}
    />
  );
}
