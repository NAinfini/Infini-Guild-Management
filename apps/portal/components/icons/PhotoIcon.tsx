import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";

export interface PhotoIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PhotoIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const MOUNTAIN_VARIANTS: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateY: [0, -2, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const PhotoIcon = forwardRef<PhotoIconHandle, PhotoIconProps>(
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
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <motion.path animate={controls} d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" initial="normal" variants={MOUNTAIN_VARIANTS} />
        </svg>
      </div>
    );
  },
);

PhotoIcon.displayName = "PhotoIcon";

export { PhotoIcon };
