import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface PinnedOffIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PinnedOffIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: {
    rotate: [0, -8, 8, -4, 0],
    translateX: [0, -1, 1, 0],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const PinnedOffIcon = forwardRef<PinnedOffIconHandle, PinnedOffIconProps>(
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
        <motion.svg animate={controls} fill="none" height={size} initial="normal" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={SVG_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3l18 18" />
          <path d="M15 4.5l-3.249 3.249m-2.57 1.433l-2.181 .818l-1.5 1.5l7 7l1.5 -1.5l.82 -2.186m1.43 -2.563l3.25 -3.251" />
          <path d="M9 15l-4.5 4.5" />
          <path d="M14.5 4l5.5 5.5" />
        </motion.svg>
      </div>
    );
  },
);

PinnedOffIcon.displayName = "PinnedOffIcon";

export { PinnedOffIcon };
