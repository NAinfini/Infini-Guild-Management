export const OVERLAY_BACKDROP_CLASS_NAME = "bg-black/60"

export const OVERLAY_SURFACE_CLASS_NAME =
  "border border-border bg-popover text-popover-foreground shadow-lg"

// Base UI owns the exit lifecycle; ending styles must remain hidden until unmount.
export const POPUP_MOTION_CLASS_NAME =
  "[transition:opacity_var(--motion-state),scale_var(--motion-state)] data-starting-style:opacity-0 data-starting-style:scale-95 data-ending-style:opacity-0 data-ending-style:scale-95 data-closed:pointer-events-none motion-reduce:transition-none motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100"

export const OVERLAY_BACKDROP_MOTION_CLASS_NAME =
  "[transition:opacity_var(--motion-overlay)] data-ending-style:[transition:opacity_var(--motion-state)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"

export const OVERLAY_SURFACE_MOTION_CLASS_NAME =
  "[transition:scale_var(--motion-panel),opacity_var(--motion-panel)] data-ending-style:[transition:scale_var(--motion-state),opacity_var(--motion-state)] data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98] motion-reduce:transition-none motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100"

export const OVERLAY_EDGE_MOTION_CLASS_NAME =
  "[transition:translate_var(--motion-panel),opacity_var(--motion-panel)] data-ending-style:[transition:translate_var(--motion-state),opacity_var(--motion-state)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none motion-reduce:data-ending-style:[translate:0_0] motion-reduce:data-starting-style:[translate:0_0]"
