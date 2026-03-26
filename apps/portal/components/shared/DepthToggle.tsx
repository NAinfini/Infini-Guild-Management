import { forwardRef, type ReactNode } from "react";
import { Tooltip } from "@mantine/core";
import { DepthToggle as BaseDepthToggle, type DepthToggleProps as BaseProps } from "@infini-dev-kit/react";

type TooltipConfig = string | { label: ReactNode; withArrow?: boolean };

export interface DepthToggleProps extends BaseProps {
  tooltip?: TooltipConfig;
}

export const DepthToggle = forwardRef<HTMLButtonElement, DepthToggleProps>(
  ({ tooltip, ...rest }, ref) => {
    const toggle = <BaseDepthToggle ref={ref} {...rest} />;
    if (!tooltip) return toggle;
    const tipProps = typeof tooltip === "string" ? { label: tooltip } : tooltip;
    return <Tooltip {...tipProps}>{toggle}</Tooltip>;
  },
);
DepthToggle.displayName = "DepthToggle";
