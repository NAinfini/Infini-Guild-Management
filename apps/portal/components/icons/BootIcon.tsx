import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface BootIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BootIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { y: 0, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { y: [0, -2, 1, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const BootIcon = forwardRef<BootIconHandle, BootIconProps>(
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
          <path d="M7 21h12a1 1 0 0 0 1-1v-2a3 3 0 0 0-3-3h-1V7a4 4 0 0 0-4-4h-1a3 3 0 0 0-3 3v4H7a3 3 0 0 0-3 3v1a1 1 0 0 0 1 1h3v2a1 1 0 0 1-1 1z" />
        </motion.svg>
      </div>
    );
  },
);

BootIcon.displayName = "BootIcon";

export { BootIcon };
