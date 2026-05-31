import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface H3IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface H3IconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateY: [0, -2, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const H3Icon = forwardRef<H3IconHandle, H3IconProps>(
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
          <path d="M19 14a2 2 0 1 0 -2 -2" />
          <path d="M17 16a2 2 0 1 0 2 -2" />
          <path d="M4 6v12" />
          <path d="M12 6v12" />
          <path d="M11 18h2" />
          <path d="M3 18h2" />
          <path d="M4 12h8" />
          <path d="M3 6h2" />
          <path d="M11 6h2" />
        </motion.svg>
      </div>
    );
  },
);

H3Icon.displayName = "H3Icon";

export { H3Icon };
