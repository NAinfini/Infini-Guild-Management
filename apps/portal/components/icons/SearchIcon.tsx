import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface SearchIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SearchIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CIRCLE_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { scale: [1, 0.9, 1.1, 1], transition: { duration: 0.5, ease: "easeInOut" } },
};

const LINE_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: {
    translateX: [0, 2, -1, 0],
    translateY: [0, 2, -1, 0],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const SearchIcon = forwardRef<SearchIconHandle, SearchIconProps>(
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
          <motion.circle animate={controls} cx="11" cy="11" initial="normal" r="8" variants={CIRCLE_VARIANTS} />
          <motion.line animate={controls} initial="normal" variants={LINE_VARIANTS} x1="21" x2="16.65" y1="21" y2="16.65" />
        </svg>
      </div>
    );
  },
);

SearchIcon.displayName = "SearchIcon";

export { SearchIcon };
