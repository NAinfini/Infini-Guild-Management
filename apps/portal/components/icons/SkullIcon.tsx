import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface SkullIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SkullIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { scale: [1, 1.12, 0.96, 1], transition: { duration: 0.45, ease: "easeInOut" } },
};

const SkullIcon = forwardRef<SkullIconHandle, SkullIconProps>(
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
          {/* 颅顶 + 方下颌，眼窝画成圆——2px 描边下小圆本来就糊成一团，正好是眼窝。 */}
          <path d="M12 3c-4.4 0-8 3.3-8 7.5 0 2.4 1.1 4.5 3 5.8V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2.7c1.9-1.3 3-3.4 3-5.8C20 6.3 16.4 3 12 3z" />
          <circle cx="9" cy="11" r="1.6" />
          <circle cx="15" cy="11" r="1.6" />
          <path d="M10 21v-3" />
          <path d="M14 21v-3" />
        </motion.svg>
      </div>
    );
  },
);

SkullIcon.displayName = "SkullIcon";

export { SkullIcon };
