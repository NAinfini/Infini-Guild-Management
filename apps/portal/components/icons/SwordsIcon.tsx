import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface SwordsIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SwordsIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LEFT_SWORD_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotate: [0, -12, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const RIGHT_SWORD_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotate: [0, 12, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const SwordsIcon = forwardRef<SwordsIconHandle, SwordsIconProps>(
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
          <motion.g animate={controls} initial="normal" style={{ transformOrigin: "50% 50%", transformBox: "fill-box" }} variants={LEFT_SWORD_VARIANTS}>
            <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
            <line x1="13" x2="9" y1="19" y2="15" />
          </motion.g>
          <motion.g animate={controls} initial="normal" style={{ transformOrigin: "50% 50%", transformBox: "fill-box" }} variants={RIGHT_SWORD_VARIANTS}>
            <polyline points="9.5 17.5 21 6 21 3 18 3 6.5 14.5" />
            <line x1="11" x2="15" y1="19" y2="15" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

SwordsIcon.displayName = "SwordsIcon";

export { SwordsIcon };
