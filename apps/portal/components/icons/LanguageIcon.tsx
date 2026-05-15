import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface LanguageIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LanguageIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotateY: [0, 90, 0], transition: { duration: 0.6, ease: "easeInOut" } },
};

const LanguageIcon = forwardRef<LanguageIconHandle, LanguageIconProps>(
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
        <motion.svg animate={controls} fill="none" height={size} initial="normal" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={{ perspective: 200 }} variants={SVG_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M9 6.371c0 4.418 -2.239 6.629 -5 6.629" />
          <path d="M4 6.371h7" />
          <path d="M5 9c0 2.144 2.252 3.908 6 4" />
          <path d="M12 20l4 -9l4 9" />
          <path d="M19.1 18h-6.2" />
          <path d="M6.694 3l.793 .582" />
        </motion.svg>
      </div>
    );
  },
);

LanguageIcon.displayName = "LanguageIcon";

export { LanguageIcon };
