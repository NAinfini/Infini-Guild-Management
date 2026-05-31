import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface LetterSpacingIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LetterSpacingIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LEFT_ARROW_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [0, -2, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const RIGHT_ARROW_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [0, 2, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const LetterSpacingIcon = forwardRef<LetterSpacingIconHandle, LetterSpacingIconProps>(
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
          <path d="M5 12v-5.5a2.5 2.5 0 0 1 5 0v5.5m0 -4h-5" />
          <path d="M13 4l3 8l3 -8" />
          <path d="M5 18h14" />
          <motion.g animate={controls} initial="normal" variants={RIGHT_ARROW_VARIANTS}>
            <path d="M17 20l2 -2l-2 -2" />
          </motion.g>
          <motion.g animate={controls} initial="normal" variants={LEFT_ARROW_VARIANTS}>
            <path d="M7 16l-2 2l2 2" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

LetterSpacingIcon.displayName = "LetterSpacingIcon";

export { LetterSpacingIcon };
