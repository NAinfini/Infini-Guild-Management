import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface MaskIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MaskIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { rotate: [0, -6, 6, 0], transition: { duration: 0.4, ease: "easeInOut" } },
};

const MaskIcon = forwardRef<MaskIconHandle, MaskIconProps>(
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
          {/* 眼罩式面具：下缘中间那个尖是鼻梁，没有它就是一副墨镜。 */}
          <path d="M2.5 9h19v3a4.5 4.5 0 0 1-4.5 4.5c-2.5 0-4-1.6-5-3-1 1.4-2.5 3-5 3A4.5 4.5 0 0 1 2.5 12z" />
          <circle cx="7.6" cy="12" r="1.5" />
          <circle cx="16.4" cy="12" r="1.5" />
        </motion.svg>
      </div>
    );
  },
);

MaskIcon.displayName = "MaskIcon";

export { MaskIcon };
