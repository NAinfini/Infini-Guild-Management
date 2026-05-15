import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface TargetIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TargetIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const OUTER_VARIANTS: Variants = {
  normal: { scale: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.1, 1], opacity: [1, 0.7, 1], transition: { duration: 0.5, ease: "easeInOut" } },
};

const MIDDLE_VARIANTS: Variants = {
  normal: { scale: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.15, 1], opacity: [1, 0.7, 1], transition: { duration: 0.5, ease: "easeInOut", delay: 0.1 } },
};

const INNER_VARIANTS: Variants = {
  normal: { scale: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.2, 1], opacity: [1, 0.7, 1], transition: { duration: 0.5, ease: "easeInOut", delay: 0.2 } },
};

const TargetIcon = forwardRef<TargetIconHandle, TargetIconProps>(
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
          <motion.circle animate={controls} cx="12" cy="12" initial="normal" r="10" variants={OUTER_VARIANTS} />
          <motion.circle animate={controls} cx="12" cy="12" initial="normal" r="6" variants={MIDDLE_VARIANTS} />
          <motion.circle animate={controls} cx="12" cy="12" initial="normal" r="2" variants={INNER_VARIANTS} />
        </svg>
      </div>
    );
  },
);

TargetIcon.displayName = "TargetIcon";

export { TargetIcon };
