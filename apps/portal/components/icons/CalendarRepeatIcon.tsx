import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface CalendarRepeatIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CalendarRepeatIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const REPEAT_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotate: [0, 360], transition: { duration: 0.6, ease: "easeInOut" } },
};

const CalendarRepeatIcon = forwardRef<CalendarRepeatIconHandle, CalendarRepeatIconProps>(
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
          <path d="M12.5 21h-6.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v3" />
          <path d="M16 3v4" />
          <path d="M8 3v4" />
          <path d="M4 11h12" />
          <motion.g animate={controls} initial="normal" style={{ transformOrigin: "20px 18px" }} variants={REPEAT_VARIANTS}>
            <path d="M20 14l2 2h-3" />
            <path d="M20 18l2 -2" />
            <path d="M19 16a3 3 0 1 0 2 5.236" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

CalendarRepeatIcon.displayName = "CalendarRepeatIcon";

export { CalendarRepeatIcon };
