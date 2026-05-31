import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface TargetArrowIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TargetArrowIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ARROW_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: {
    translateX: [3, -1, 0],
    translateY: [-3, 1, 0],
    transition: { duration: 0.5, type: "spring", stiffness: 200, damping: 12 },
  },
};

const TargetArrowIcon = forwardRef<TargetArrowIconHandle, TargetArrowIconProps>(
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
          <path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          <path d="M12 7a5 5 0 1 0 5 5" />
          <path d="M13 3.055a9 9 0 1 0 7.941 7.945" />
          <motion.g animate={controls} initial="normal" variants={ARROW_VARIANTS}>
            <path d="M15 6v3h3l3 -3h-3v-3l-3 3" />
            <path d="M15 9l-3 3" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

TargetArrowIcon.displayName = "TargetArrowIcon";

export { TargetArrowIcon };
