import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface WandIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface WandIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { rotate: [0, -14, 8, 0], transition: { duration: 0.45, ease: "easeInOut" } },
};

const WandIcon = forwardRef<WandIconHandle, WandIconProps>(
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
          {/* 短杖 + 杖尖一颗星。跟法杖（长杖 + 圆宝石）的分界就在这颗星上。 */}
          <path d="M3.5 20.5 13 11" />
          <path d="M17 3 18.4 6.6 22 8 18.4 9.4 17 13 15.6 9.4 12 8 15.6 6.6z" />
          <path d="M4.5 6.5 5.5 4.5" />
        </motion.svg>
      </div>
    );
  },
);

WandIcon.displayName = "WandIcon";

export { WandIcon };
