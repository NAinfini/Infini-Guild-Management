import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface LockOpenIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LockOpenIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SHACKLE_VARIANTS: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateY: [0, -3, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const LockOpenIcon = forwardRef<LockOpenIconHandle, LockOpenIconProps>(
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
          <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -6" />
          <path d="M11 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          <motion.path animate={controls} d="M8 11v-5a4 4 0 0 1 8 0" initial="normal" variants={SHACKLE_VARIANTS} />
        </svg>
      </div>
    );
  },
);

LockOpenIcon.displayName = "LockOpenIcon";

export { LockOpenIcon };
