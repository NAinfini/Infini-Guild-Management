import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface UnderlineIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UnderlineIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const UNDERLINE_VARIANTS: Variants = {
  normal: { pathLength: 1, pathOffset: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { pathLength: [0, 1], pathOffset: [1, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const UnderlineIcon = forwardRef<UnderlineIconHandle, UnderlineIconProps>(
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
          <path d="M7 5v5a5 5 0 0 0 10 0v-5" />
          <motion.path animate={controls} d="M5 19h14" initial="normal" variants={UNDERLINE_VARIANTS} />
        </svg>
      </div>
    );
  },
);

UnderlineIcon.displayName = "UnderlineIcon";

export { UnderlineIcon };
