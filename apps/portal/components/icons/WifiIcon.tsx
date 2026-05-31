import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface WifiIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface WifiIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DOT_VARIANTS: Variants = {
  normal: { opacity: 1, transition: { duration: 0.3 } },
  animate: { opacity: [1, 0.3, 1], transition: { duration: 0.6, ease: "easeInOut", delay: 0 } },
};

const WAVE1_VARIANTS: Variants = {
  normal: { opacity: 1, transition: { duration: 0.3 } },
  animate: { opacity: [0.3, 1, 0.3, 1], transition: { duration: 0.8, ease: "easeInOut", delay: 0.1 } },
};

const WAVE2_VARIANTS: Variants = {
  normal: { opacity: 1, transition: { duration: 0.3 } },
  animate: { opacity: [0.3, 1, 0.3, 1], transition: { duration: 0.8, ease: "easeInOut", delay: 0.2 } },
};

const WAVE3_VARIANTS: Variants = {
  normal: { opacity: 1, transition: { duration: 0.3 } },
  animate: { opacity: [0.3, 1, 0.3, 1], transition: { duration: 0.8, ease: "easeInOut", delay: 0.3 } },
};

const WifiIcon = forwardRef<WifiIconHandle, WifiIconProps>(
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
          <motion.path animate={controls} d="M12 18l.01 0" initial="normal" variants={DOT_VARIANTS} />
          <motion.path animate={controls} d="M9.172 15.172a4 4 0 0 1 5.656 0" initial="normal" variants={WAVE1_VARIANTS} />
          <motion.path animate={controls} d="M6.343 12.343a8 8 0 0 1 11.314 0" initial="normal" variants={WAVE2_VARIANTS} />
          <motion.path animate={controls} d="M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0" initial="normal" variants={WAVE3_VARIANTS} />
        </svg>
      </div>
    );
  },
);

WifiIcon.displayName = "WifiIcon";

export { WifiIcon };
