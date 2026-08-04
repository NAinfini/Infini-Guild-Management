import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface AxeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AxeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.3 } },
  // 多关键帧不能配 spring，见 ShieldIcon 的说明。
  animate: { rotate: [0, -14, 8, 0], transition: { duration: 0.45, ease: "easeInOut" } },
};

const AxeIcon = forwardRef<AxeIconHandle, AxeIconProps>(
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
          {/*
            前四稿全废在同一件事上：斧头画小了、柄画长了，比例一到就读成旗子（柄上挂一片布）。
            现在斧头占掉大半张图、柄退成一条细线穿过斧眼，柄尾在斧背后头露出一小截——
            「刃在一侧、背在另一侧、柄从中间穿过去」这三样凑齐才是斧头。
            整体转 -40°，跟 SwordIcon 一样刃朝右上。
          */}
          <g transform="rotate(-40 12 12)">
            <path d="M12 22V4.5" />
            <path d="M8 5.5H12.5C17 5 20.5 7.5 21 12.5C16.5 13.5 12 12 8 10.5Z" />
          </g>
        </motion.svg>
      </div>
    );
  },
);

AxeIcon.displayName = "AxeIcon";

export { AxeIcon };
