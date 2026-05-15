import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface SeparatorHorizontalIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SeparatorHorizontalIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TOP_ARROW_VARIANTS: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateY: [-2, 0], transition: { duration: 0.4, type: "spring", stiffness: 200, damping: 15 } },
};

const BOTTOM_ARROW_VARIANTS: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateY: [2, 0], transition: { duration: 0.4, type: "spring", stiffness: 200, damping: 15 } },
};

const SeparatorHorizontalIcon = forwardRef<SeparatorHorizontalIconHandle, SeparatorHorizontalIconProps>(
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
          <path d="M4 12l16 0" />
          <motion.path animate={controls} d="M8 8l4 -4l4 4" initial="normal" variants={TOP_ARROW_VARIANTS} />
          <motion.path animate={controls} d="M16 16l-4 4l-4 -4" initial="normal" variants={BOTTOM_ARROW_VARIANTS} />
        </svg>
      </div>
    );
  },
);

SeparatorHorizontalIcon.displayName = "SeparatorHorizontalIcon";

export { SeparatorHorizontalIcon };
