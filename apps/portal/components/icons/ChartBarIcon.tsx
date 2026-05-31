import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ChartBarIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ChartBarIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BAR_LEFT_VARIANTS: Variants = {
  normal: { scaleY: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { scaleY: [0.5, 1], transition: { duration: 0.4, ease: "easeOut", delay: 0 } },
};

const BAR_MID_VARIANTS: Variants = {
  normal: { scaleY: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { scaleY: [0.5, 1], transition: { duration: 0.4, ease: "easeOut", delay: 0.1 } },
};

const BAR_RIGHT_VARIANTS: Variants = {
  normal: { scaleY: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { scaleY: [0.5, 1], transition: { duration: 0.4, ease: "easeOut", delay: 0.2 } },
};

const ChartBarIcon = forwardRef<ChartBarIconHandle, ChartBarIconProps>(
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
          <motion.path animate={controls} d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6" initial="normal" style={{ transformOrigin: "6px 20px" }} variants={BAR_LEFT_VARIANTS} />
          <motion.path animate={controls} d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10" initial="normal" style={{ transformOrigin: "18px 20px" }} variants={BAR_RIGHT_VARIANTS} />
          <motion.path animate={controls} d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14" initial="normal" style={{ transformOrigin: "12px 20px" }} variants={BAR_MID_VARIANTS} />
          <path d="M4 20h14" />
        </svg>
      </div>
    );
  },
);

ChartBarIcon.displayName = "ChartBarIcon";

export { ChartBarIcon };
