import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface VolumeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface VolumeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const WAVE_VARIANTS: Variants = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3 } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, ease: "easeOut" } },
};

const WAVE_2_VARIANTS: Variants = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3 } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, ease: "easeOut", delay: 0.15 } },
};

const VolumeIcon = forwardRef<VolumeIconHandle, VolumeIconProps>(
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
          <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
          <motion.path animate={controls} d="M16 9a5 5 0 0 1 0 6" initial="normal" variants={WAVE_VARIANTS} />
          <motion.path animate={controls} d="M19.364 18.364a9 9 0 0 0 0-12.728" initial="normal" variants={WAVE_2_VARIANTS} />
        </svg>
      </div>
    );
  },
);

VolumeIcon.displayName = "VolumeIcon";

export { VolumeIcon };
