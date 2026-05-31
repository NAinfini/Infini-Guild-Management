import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface PauseIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PauseIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BAR_VARIANTS: Variants = {
  normal: { scaleY: 1, transition: { duration: 0.3 } },
  animate: { scaleY: [1, 0.8, 1], transition: { duration: 0.4, ease: "easeOut" } },
};

const PauseIcon = forwardRef<PauseIconHandle, PauseIconProps>(
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
          <motion.rect animate={controls} height="16" initial="normal" rx="1" variants={BAR_VARIANTS} width="4" x="14" y="4" />
          <motion.rect animate={controls} height="16" initial="normal" rx="1" variants={BAR_VARIANTS} width="4" x="6" y="4" />
        </svg>
      </div>
    );
  },
);

PauseIcon.displayName = "PauseIcon";

export { PauseIcon };
