import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ScrollIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ScrollIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { scaleY: 1, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。展开一点再收回去。
  animate: { scaleY: [1, 1.12, 0.97, 1], transition: { duration: 0.45, ease: "easeInOut" } },
};

const ScrollIcon = forwardRef<ScrollIconHandle, ScrollIconProps>(
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
          {/* 上下两端是卷起来的纸卷，要有厚度。画成两根细轴试过，整枚读成一张表格。 */}
          <path d="M6.25 3h11.5a1.75 1.75 0 0 1 0 3.5H6.25a1.75 1.75 0 0 1 0-3.5z" />
          <path d="M6.25 17.5h11.5a1.75 1.75 0 0 1 0 3.5H6.25a1.75 1.75 0 0 1 0-3.5z" />
          <path d="M6.25 6.5v11" />
          <path d="M17.75 6.5v11" />
          <path d="M9.5 12h5" />
        </motion.svg>
      </div>
    );
  },
);

ScrollIcon.displayName = "ScrollIcon";

export { ScrollIcon };
