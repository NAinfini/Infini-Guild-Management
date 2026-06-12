import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface WarehouseIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface WarehouseIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DOOR_VARIANTS: Variants = {
  normal: { y: 0, transition: { duration: 0.2, ease: "easeOut" } },
  animate: { y: [0, -1, 0], transition: { duration: 0.45, ease: "easeInOut" } },
};

const WarehouseIcon = forwardRef<WarehouseIconHandle, WarehouseIconProps>(
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
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M3 10.5 12 4l9 6.5" />
          <path d="M5 9.5V20h14V9.5" />
          <motion.path animate={controls} d="M8 20v-7h8v7" initial="normal" variants={DOOR_VARIANTS} />
          <path d="M8 15h8" />
          <path d="M8 17.5h8" />
        </svg>
      </div>
    );
  },
);

WarehouseIcon.displayName = "WarehouseIcon";

export { WarehouseIcon };
