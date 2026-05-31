import { useRef, useState, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

interface MagneticElementProps {
  children: ReactNode;
  className?: string;
  strength?: number;
}

export function MagneticElement({ children, className, strength = 0.3 }: MagneticElementProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("translate(0px, 0px)");

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * strength;
    const y = (e.clientY - rect.top - rect.height / 2) * strength;
    setTransform(`translate(${x}px, ${y}px)`);
  };

  const handleMouseLeave = () => {
    setTransform("translate(0px, 0px)");
  };

  return (
    <div
      ref={ref}
      className={cn("transition-transform duration-200 ease-out", className)}
      style={{ transform }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
}
