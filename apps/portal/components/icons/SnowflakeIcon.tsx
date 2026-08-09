import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface SnowflakeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SnowflakeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  /* 只转 60 度：六角雪花转满一格就回到自己，转多了反而看不出在转。 */
  animate: { rotate: [0, 60], transition: { duration: 0.6, ease: "easeInOut" } },
};

const SnowflakeIcon = forwardRef<SnowflakeIconHandle, SnowflakeIconProps>(
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
          {/* 三条主轴 + 上下两组分叉。六个端点都加分叉的话，20px 下会糊成一个墨点。 */}
          <path d="M12 2v20" />
          <path d="M4.2 6.5 19.8 17.5" />
          <path d="M4.2 17.5 19.8 6.5" />
          <path d="M9.5 4.5 12 7l2.5-2.5" />
          <path d="M9.5 19.5 12 17l2.5 2.5" />
        </motion.svg>
      </div>
    );
  },
);

SnowflakeIcon.displayName = "SnowflakeIcon";

export { SnowflakeIcon };
