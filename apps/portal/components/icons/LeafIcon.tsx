import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface LeafIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LeafIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { rotate: [0, -10, 8, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const LeafIcon = forwardRef<LeafIconHandle, LeafIconProps>(
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
          {/* 叶身 + 叶脉 + 一小截叶柄。叶脉不能省，省了就是一颗歪水滴。 */}
          <path d="M5 19c0-8 5-13 14-14 1 9-4 15-14 14z" />
          <path d="M5 19c3-4.5 6.5-7 10-8.5" />
          <path d="M3 21 5 19" />
        </motion.svg>
      </div>
    );
  },
);

LeafIcon.displayName = "LeafIcon";

export { LeafIcon };
