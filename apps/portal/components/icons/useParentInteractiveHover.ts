import { useEffect, useRef } from "react";
import type { useAnimation } from "motion/react";

const INTERACTIVE_SELECTOR = "button, a, [role='button'], [role='menuitem'], [role='tab'], [role='option'], [data-animate-icon-trigger]";

export function useParentInteractiveHover(
  controls: ReturnType<typeof useAnimation>,
  isControlledRef: React.RefObject<boolean>,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isControlledRef.current) return;
    const el = wrapperRef.current;
    if (!el) return;
    const parent = el.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
    if (!parent || parent === el) return;

    const onEnter = () => controls.start("animate");
    const onLeave = () => controls.start("normal");
    parent.addEventListener("mouseenter", onEnter);
    parent.addEventListener("mouseleave", onLeave);
    return () => {
      parent.removeEventListener("mouseenter", onEnter);
      parent.removeEventListener("mouseleave", onLeave);
    };
  }, [controls, isControlledRef]);

  return wrapperRef;
}
