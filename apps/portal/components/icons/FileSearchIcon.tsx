import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";

export interface FileSearchIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface FileSearchIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const GLASS_VARIANTS: Variants = {
  normal: { scale: 1, transition: { duration: 0.3 } },
  animate: { scale: [1, 1.15, 1], transition: { duration: 0.5, ease: "easeInOut" } },
};

const FileSearchIcon = forwardRef<FileSearchIconHandle, FileSearchIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

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
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3" />
          <motion.circle animate={controls} cx="6" cy="14" initial="normal" r="3" variants={GLASS_VARIANTS} />
          <path d="m8.5 16.5 1.5 1.5" />
        </svg>
      </div>
    );
  },
);

FileSearchIcon.displayName = "FileSearchIcon";

export { FileSearchIcon };
