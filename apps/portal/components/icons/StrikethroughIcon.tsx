import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface StrikethroughIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface StrikethroughIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LINE_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [-5, 0], transition: { duration: 0.4, ease: "easeOut" } },
};

const S_VARIANTS: Variants = {
  normal: { opacity: 1, transition: { duration: 0.3 } },
  animate: { opacity: [0.5, 1], transition: { duration: 0.4, ease: "easeOut" } },
};

const StrikethroughIcon = forwardRef<StrikethroughIconHandle, StrikethroughIconProps>(
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
          <motion.path animate={controls} d="M5 12l14 0" initial="normal" variants={LINE_VARIANTS} />
          <motion.path animate={controls} d="M16 6.5a4 2 0 0 0 -4 -1.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5a4 2 0 0 1 -4 -1.5" initial="normal" variants={S_VARIANTS} />
        </svg>
      </div>
    );
  },
);

StrikethroughIcon.displayName = "StrikethroughIcon";

export { StrikethroughIcon };
