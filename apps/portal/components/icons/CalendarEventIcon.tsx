import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";

export interface CalendarEventIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CalendarEventIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.05, 1], transition: { duration: 0.4, ease: "easeInOut" } },
};

const DOT_VARIANTS: Variants = {
  normal: { scale: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.5, 1], opacity: [1, 0.6, 1], transition: { duration: 0.5, ease: "easeInOut" } },
};

const CalendarEventIcon = forwardRef<CalendarEventIconHandle, CalendarEventIconProps>(
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
        <motion.svg animate={controls} fill="none" height={size} initial="normal" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={SVG_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <rect height="18" rx="2" width="18" x="3" y="4" />
          <path d="M3 10h18" />
          <motion.path animate={controls} d="M8 14h.01" initial="normal" variants={DOT_VARIANTS} />
          <motion.path animate={controls} d="M12 14h.01" initial="normal" variants={DOT_VARIANTS} />
          <motion.path animate={controls} d="M16 14h.01" initial="normal" variants={DOT_VARIANTS} />
          <path d="M8 18h.01" />
          <path d="M12 18h.01" />
          <path d="M16 18h.01" />
        </motion.svg>
      </div>
    );
  },
);

CalendarEventIcon.displayName = "CalendarEventIcon";

export { CalendarEventIcon };
