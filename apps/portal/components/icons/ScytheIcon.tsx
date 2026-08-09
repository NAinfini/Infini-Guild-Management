import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface ScytheIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ScytheIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { rotate: [0, -12, 6, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const ScytheIcon = forwardRef<ScytheIconHandle, ScytheIconProps>(
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
          {/* 长柄斜着立，刃从柄头往左弯出去一整片新月，柄上那道是握把。
              刃的下缘必须是凹的，凸的话整个读成一片叶子。 */}
          <path d="M6 21 16.5 5.5" />
          <path d="M16.5 5.5C11 3 5.5 4.5 3 8.5c4-1.5 8.5-1 11.5 1.2z" />
          <path d="M9.5 15.5 11.8 17.6" />
        </motion.svg>
      </div>
    );
  },
);

ScytheIcon.displayName = "ScytheIcon";

export { ScytheIcon };
