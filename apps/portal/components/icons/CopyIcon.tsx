import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface CopyIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CopyIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const FRONT_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [-2, -2, 0], translateY: [2, 2, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const BACK_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [1, 1, 0], translateY: [-1, -1, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const CopyIcon = forwardRef<CopyIconHandle, CopyIconProps>(
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
          <motion.rect animate={controls} height="13" initial="normal" rx="2" ry="2" variants={FRONT_VARIANTS} width="13" x="9" y="9" />
          <motion.path animate={controls} d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" initial="normal" variants={BACK_VARIANTS} />
        </svg>
      </div>
    );
  },
);

CopyIcon.displayName = "CopyIcon";

export { CopyIcon };
