import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ColumnInsertRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ColumnInsertRightIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PLUS_VARIANTS: Variants = {
  normal: { scale: 1, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { scale: [0, 1.2, 1], opacity: [0, 1, 1], transition: { duration: 0.4, type: "spring", stiffness: 200, damping: 15 } },
};

const ColumnInsertRightIcon = forwardRef<ColumnInsertRightIconHandle, ColumnInsertRightIconProps>(
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
          <path d="M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1" />
          <motion.g animate={controls} initial="normal" style={{ transformOrigin: "17px 12px" }} variants={PLUS_VARIANTS}>
            <path d="M15 12l4 0" />
            <path d="M17 10l0 4" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

ColumnInsertRightIcon.displayName = "ColumnInsertRightIcon";

export { ColumnInsertRightIcon };
