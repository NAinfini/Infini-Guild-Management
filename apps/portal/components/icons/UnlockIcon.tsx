import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";

export interface UnlockIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UnlockIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SHACKLE_VARIANTS: Variants = {
  normal: { rotate: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotate: [0, -8, 0], translateY: [0, -2, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const UnlockIcon = forwardRef<UnlockIconHandle, UnlockIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

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
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
          <motion.path animate={controls} d="M7 11V7a5 5 0 0 1 9.9-1" initial="normal" variants={SHACKLE_VARIANTS} />
        </svg>
      </div>
    );
  },
);

UnlockIcon.displayName = "UnlockIcon";

export { UnlockIcon };
