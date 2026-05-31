import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface TableOffIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TableOffIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const SLASH_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, ease: "easeOut" } },
};

const TableOffIcon = forwardRef<TableOffIconHandle, TableOffIconProps>(
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
          <path d="M7 3h12a2 2 0 0 1 2 2v12m-.585 3.413a1.994 1.994 0 0 1 -1.415 .587h-14a2 2 0 0 1 -2 -2v-14c0 -.55 .223 -1.05 .583 -1.412" />
          <path d="M3 10h7m4 0h7" />
          <path d="M10 3v3m0 4v11" />
          <motion.path animate={controls} d="M3 3l18 18" initial="normal" variants={SLASH_VARIANTS} />
        </svg>
      </div>
    );
  },
);

TableOffIcon.displayName = "TableOffIcon";

export { TableOffIcon };
