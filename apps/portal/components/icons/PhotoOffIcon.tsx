import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface PhotoOffIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PhotoOffIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SLASH_VARIANTS: Variants = {
  normal: { pathLength: 1, transition: { duration: 0.2, ease: "easeOut" } },
  animate: { pathLength: [1, 0.72, 1], transition: { duration: 0.42, ease: "easeInOut" } },
};

const PhotoOffIcon = forwardRef<PhotoOffIconHandle, PhotoOffIconProps>(
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
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) { onMouseEnter?.(event); } else { controls.start("animate"); }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) { onMouseLeave?.(event); } else { controls.start("normal"); }
      },
      [controls, onMouseLeave],
    );

    return (
      <div ref={wrapperRef} className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-2.4-2.4" />
          <path d="M13.5 13.5 6 21" />
          <motion.path animate={controls} d="M4 4 20 20" initial="normal" variants={SLASH_VARIANTS} />
        </svg>
      </div>
    );
  },
);

PhotoOffIcon.displayName = "PhotoOffIcon";

export { PhotoOffIcon };
