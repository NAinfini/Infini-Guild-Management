import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@portal/utils/cn";
import { useParentInteractiveHover } from "./useParentInteractiveHover";

export interface LinkIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LinkIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TOP_LINK_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [0, 1, 0], translateY: [0, -1, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const BOTTOM_LINK_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, transition: { duration: 0.3, ease: "easeOut" } },
  animate: { translateX: [0, -1, 0], translateY: [0, 1, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const LinkIcon = forwardRef<LinkIconHandle, LinkIconProps>(
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
          <path d="M9 15l6 -6" />
          <motion.path animate={controls} d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" initial="normal" variants={TOP_LINK_VARIANTS} />
          <motion.path animate={controls} d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" initial="normal" variants={BOTTOM_LINK_VARIANTS} />
        </svg>
      </div>
    );
  },
);

LinkIcon.displayName = "LinkIcon";

export { LinkIcon };
