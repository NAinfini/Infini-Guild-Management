import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface AlignLeftIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AlignLeftIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TOP_LINE_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [3, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const MIDDLE_LINE_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [5, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const BOTTOM_LINE_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [4, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const AlignLeftIcon = forwardRef<AlignLeftIconHandle, AlignLeftIconProps>(
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
          <motion.path animate={controls} d="M4 6l16 0" initial="normal" variants={TOP_LINE_VARIANTS} />
          <motion.path animate={controls} d="M4 12l10 0" initial="normal" variants={MIDDLE_LINE_VARIANTS} />
          <motion.path animate={controls} d="M4 18l14 0" initial="normal" variants={BOTTOM_LINE_VARIANTS} />
        </svg>
      </div>
    );
  },
);

AlignLeftIcon.displayName = "AlignLeftIcon";

export { AlignLeftIcon };
