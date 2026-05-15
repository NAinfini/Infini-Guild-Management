import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ListNumbersIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ListNumbersIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const lineVariants = (delay: number): Variants => ({
  normal: { translateX: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [6, 0], opacity: [0, 1], transition: { duration: 0.3, ease: "easeOut", delay } },
});

const LINE1_VARIANTS = lineVariants(0);
const LINE2_VARIANTS = lineVariants(0.1);
const LINE3_VARIANTS = lineVariants(0.2);

const ListNumbersIcon = forwardRef<ListNumbersIconHandle, ListNumbersIconProps>(
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
          <motion.path animate={controls} d="M11 6h9" initial="normal" variants={LINE1_VARIANTS} />
          <motion.path animate={controls} d="M11 12h9" initial="normal" variants={LINE2_VARIANTS} />
          <motion.path animate={controls} d="M12 18h8" initial="normal" variants={LINE3_VARIANTS} />
          <path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" />
          <path d="M6 10v-6l-2 2" />
        </svg>
      </div>
    );
  },
);

ListNumbersIcon.displayName = "ListNumbersIcon";

export { ListNumbersIcon };
