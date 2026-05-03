import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";

export interface ShareIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ShareIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LINE_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, delay: 0.1 } },
};

const ShareIcon = forwardRef<ShareIconHandle, ShareIconProps>(
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
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <motion.line animate={controls} initial="normal" variants={LINE_VARIANTS} x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
          <motion.line animate={controls} initial="normal" variants={LINE_VARIANTS} x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
        </svg>
      </div>
    );
  },
);

ShareIcon.displayName = "ShareIcon";

export { ShareIcon };
