import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface PencilIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PencilIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PENCIL_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, rotate: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: {
    translateX: [0, -1.5, 0],
    translateY: [0, 1.5, 0],
    rotate: [0, -5, 0],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const PencilIcon = forwardRef<PencilIconHandle, PencilIconProps>(
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
        <motion.svg animate={controls} fill="none" height={size} initial="normal" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={PENCIL_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <path d="m15 5 4 4" />
        </motion.svg>
      </div>
    );
  },
);

PencilIcon.displayName = "PencilIcon";

export { PencilIcon };
