import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface HeartbeatIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface HeartbeatIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3, ease: "easeOut" } },
  animate: {
    scale: [1, 1.15, 1, 1.1, 1],
    transition: { duration: 0.6, ease: "easeInOut", times: [0, 0.2, 0.4, 0.6, 1] },
  },
};

const HeartbeatIcon = forwardRef<HeartbeatIconHandle, HeartbeatIconProps>(
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
          <path d="M19.5 13.572l-7.5 7.428l-2.896 -2.868m-6.117 -8.104a5 5 0 0 1 9.013 -3.022a5 5 0 1 1 7.5 6.572" />
          <path d="M3 13h2l2 3l2 -6l1 3h3" />
        </motion.svg>
      </div>
    );
  },
);

HeartbeatIcon.displayName = "HeartbeatIcon";

export { HeartbeatIcon };
