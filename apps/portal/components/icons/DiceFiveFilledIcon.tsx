import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface DiceFiveFilledIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface DiceFiveFilledIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SVG_VARIANTS: Variants = {
  normal: { rotateX: 0, rotateZ: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { rotateX: [0, 360], rotateZ: [0, 360], transition: { duration: 0.6, ease: "easeInOut" } },
};

const DiceFiveFilledIcon = forwardRef<DiceFiveFilledIconHandle, DiceFiveFilledIconProps>(
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
        <motion.svg animate={controls} fill="currentColor" height={size} initial="normal" stroke="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={{ perspective: 400 }} variants={SVG_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M18.333 2c1.96 0 3.56 1.537 3.662 3.472l.005 .195v12.666c0 1.96 -1.537 3.56 -3.472 3.662l-.195 .005h-12.666a3.667 3.667 0 0 1 -3.662 -3.472l-.005 -.195v-12.666c0 -1.96 1.537 -3.56 3.472 -3.662l.195 -.005h12.666zm-2.833 12a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m-7 0a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m3.5 -3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m-3.5 -3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m7 0a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3" />
        </motion.svg>
      </div>
    );
  },
);

DiceFiveFilledIcon.displayName = "DiceFiveFilledIcon";

export { DiceFiveFilledIcon };
