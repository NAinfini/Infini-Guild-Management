import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface HighlightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface HighlightIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: {
    translateX: [0, -1.5, 0],
    translateY: [0, 1.5, 0],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const HighlightIcon = forwardRef<HighlightIconHandle, HighlightIconProps>(
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
          <path d="M3 19h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
          <path d="M12.5 5.5l4 4" />
          <path d="M4.5 13.5l4 4" />
          <path d="M21 15v4h-8l4 -4l4 0" />
        </motion.svg>
      </div>
    );
  },
);

HighlightIcon.displayName = "HighlightIcon";

export { HighlightIcon };
