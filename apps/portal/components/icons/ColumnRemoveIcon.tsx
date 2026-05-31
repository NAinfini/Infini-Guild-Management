import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ColumnRemoveIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ColumnRemoveIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const X_VARIANTS: Variants = {
  normal: { rotate: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotate: [0, 90], opacity: [0, 1], transition: { duration: 0.4, type: "spring", stiffness: 180, damping: 14 } },
};

const ColumnRemoveIcon = forwardRef<ColumnRemoveIconHandle, ColumnRemoveIconProps>(
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
          <motion.g animate={controls} initial="normal" style={{ transformOrigin: "18px 12px" }} variants={X_VARIANTS}>
            <path d="M16 10l4 4" />
            <path d="M16 14l4 -4" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

ColumnRemoveIcon.displayName = "ColumnRemoveIcon";

export { ColumnRemoveIcon };
