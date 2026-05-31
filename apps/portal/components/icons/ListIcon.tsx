import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ListIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ListIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const lineVariants = (delay: number): Variants => ({
  normal: { translateX: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [6, 0], opacity: [0, 1], transition: { duration: 0.3, ease: "easeOut", delay } },
});

const LINE1_VARIANTS = lineVariants(0);
const LINE2_VARIANTS = lineVariants(0.1);
const LINE3_VARIANTS = lineVariants(0.2);

const ListIcon = forwardRef<ListIconHandle, ListIconProps>(
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
          <motion.path animate={controls} d="M9 6l11 0" initial="normal" variants={LINE1_VARIANTS} />
          <motion.path animate={controls} d="M9 12l11 0" initial="normal" variants={LINE2_VARIANTS} />
          <motion.path animate={controls} d="M9 18l11 0" initial="normal" variants={LINE3_VARIANTS} />
          <path d="M5 6l0 .01" />
          <path d="M5 12l0 .01" />
          <path d="M5 18l0 .01" />
        </svg>
      </div>
    );
  },
);

ListIcon.displayName = "ListIcon";

export { ListIcon };
