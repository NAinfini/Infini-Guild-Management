import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface CheckboxIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CheckboxIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CHECK_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, ease: "easeOut" } },
};

const BOX_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3 } },
  animate: { scale: [0.95, 1], transition: { duration: 0.3, ease: "easeOut" } },
};

const CheckboxIcon = forwardRef<CheckboxIconHandle, CheckboxIconProps>(
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
          <motion.path animate={controls} d="M9 11l3 3l8 -8" initial="normal" variants={CHECK_VARIANTS} />
          <motion.path animate={controls} d="M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9" initial="normal" variants={BOX_VARIANTS} />
        </svg>
      </div>
    );
  },
);

CheckboxIcon.displayName = "CheckboxIcon";

export { CheckboxIcon };
