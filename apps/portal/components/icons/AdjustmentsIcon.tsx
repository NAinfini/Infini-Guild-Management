import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface AdjustmentsIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AdjustmentsIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SLIDER_1: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3 } },
  animate: { translateY: [0, -2, 0], transition: { duration: 0.4, delay: 0 } },
};

const SLIDER_2: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3 } },
  animate: { translateY: [0, 2, 0], transition: { duration: 0.4, delay: 0.1 } },
};

const SLIDER_3: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3 } },
  animate: { translateY: [0, -2, 0], transition: { duration: 0.4, delay: 0.2 } },
};

const AdjustmentsIcon = forwardRef<AdjustmentsIconHandle, AdjustmentsIconProps>(
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
          <motion.g animate={controls} initial="normal" variants={SLIDER_1}>
            <path d="M4 21v-7" />
            <path d="M4 10V3" />
            <circle cx="4" cy="12" r="2" />
          </motion.g>
          <motion.g animate={controls} initial="normal" variants={SLIDER_2}>
            <path d="M12 21v-9" />
            <path d="M12 8V3" />
            <circle cx="12" cy="10" r="2" />
          </motion.g>
          <motion.g animate={controls} initial="normal" variants={SLIDER_3}>
            <path d="M20 21v-5" />
            <path d="M20 12V3" />
            <circle cx="20" cy="14" r="2" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

AdjustmentsIcon.displayName = "AdjustmentsIcon";

export { AdjustmentsIcon };
