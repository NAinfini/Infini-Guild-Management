import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface GauntletIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface GauntletIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.1, 0.95, 1], transition: { duration: 0.4, type: "spring", stiffness: 220, damping: 12 } },
};

const GauntletIcon = forwardRef<GauntletIconHandle, GauntletIconProps>(
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
          <path d="M6 20V10c0-4 2.5-7 6-7s6 3 6 7v10" />
          <path d="M6 14h12" />
          <path d="M10 14v3" />
          <path d="M14 14v3" />
          <path d="M6 20h12" />
        </motion.svg>
      </div>
    );
  },
);

GauntletIcon.displayName = "GauntletIcon";

export { GauntletIcon };
