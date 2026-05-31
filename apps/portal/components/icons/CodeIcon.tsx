import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface CodeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CodeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LEFT_BRACKET_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [0, -2, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const RIGHT_BRACKET_VARIANTS: Variants = {
  normal: { translateX: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [0, 2, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const SLASH_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotate: [0, -5, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const CodeIcon = forwardRef<CodeIconHandle, CodeIconProps>(
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
          <motion.path animate={controls} d="M7 8l-4 4l4 4" initial="normal" variants={LEFT_BRACKET_VARIANTS} />
          <motion.path animate={controls} d="M17 8l4 4l-4 4" initial="normal" variants={RIGHT_BRACKET_VARIANTS} />
          <motion.path animate={controls} d="M14 4l-4 16" initial="normal" variants={SLASH_VARIANTS} />
        </svg>
      </div>
    );
  },
);

CodeIcon.displayName = "CodeIcon";

export { CodeIcon };
