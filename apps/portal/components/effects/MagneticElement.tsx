import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

type MagneticElementProps = {
  children: ReactNode;
  className?: string;
  strength?: number;
};

export function MagneticElement({ children, className, strength = 0.3 }: MagneticElementProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const applyTransform = () => {
    frameRef.current = null;
    if (!ref.current) return;
    ref.current.style.transform = `translate(${pointerRef.current.x}px, ${pointerRef.current.y}px)`;
  };

  const scheduleTransform = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(applyTransform);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    pointerRef.current = {
      x: (e.clientX - rect.left - rect.width / 2) * strength,
      y: (e.clientY - rect.top - rect.height / 2) * strength,
    };
    scheduleTransform();
  };

  const handleMouseLeave = () => {
    pointerRef.current = { x: 0, y: 0 };
    scheduleTransform();
  };

  return (
    <div
      ref={ref}
      className={cn("transition-transform duration-200 ease-out", className)}
      style={{ transform: "translate(0px, 0px)" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
}
