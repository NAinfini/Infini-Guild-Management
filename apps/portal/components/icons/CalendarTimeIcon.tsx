import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";

export interface CalendarTimeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CalendarTimeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const HAND_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  animate: { rotate: [0, 360], transition: { duration: 1.5, ease: "linear" } },
};

const CalendarTimeIcon = forwardRef<CalendarTimeIconHandle, CalendarTimeIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

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
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M3 10h18V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <circle cx="18" cy="18" r="4" />
          <motion.g animate={controls} initial="normal" style={{ transformOrigin: "18px 18px" }} variants={HAND_VARIANTS}>
            <path d="M18 16.5v1.5l1 1" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

CalendarTimeIcon.displayName = "CalendarTimeIcon";

export { CalendarTimeIcon };
