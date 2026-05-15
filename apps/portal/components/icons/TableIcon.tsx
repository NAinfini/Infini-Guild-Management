import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface TableIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TableIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const GRID_VARIANTS: Variants = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.5, ease: "easeInOut" } },
};

const TableIcon = forwardRef<TableIconHandle, TableIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);
    const wrapperRef = useParentInteractiveHover(controls, isControlledRef);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) { onMouseEnter?.(e); } else { controls.start("animate"); }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) { onMouseLeave?.(e); } else { controls.start("normal"); }
      },
      [controls, onMouseLeave],
    );

    return (
      <div ref={wrapperRef} className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14" />
          <motion.path animate={controls} d="M3 10h18" initial="normal" variants={GRID_VARIANTS} />
          <motion.path animate={controls} d="M10 3v18" initial="normal" variants={GRID_VARIANTS} />
        </svg>
      </div>
    );
  },
);

TableIcon.displayName = "TableIcon";

export { TableIcon };
