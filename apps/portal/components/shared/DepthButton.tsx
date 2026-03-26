import { forwardRef, type ReactNode } from "react";
import { Tooltip } from "@mantine/core";
import { DepthButton as BaseDepthButton, type DepthButtonProps as BaseProps } from "@infini-dev-kit/react";

type TooltipConfig = string | { label: ReactNode; withArrow?: boolean };

export interface DepthButtonProps extends BaseProps {
  tooltip?: TooltipConfig;
  loading?: boolean;
}

export const DepthButton = forwardRef<HTMLButtonElement, DepthButtonProps>(
  ({ tooltip, loading, disabled, children, ...rest }, ref) => {
    const btn = (
      <BaseDepthButton ref={ref} disabled={disabled || loading} {...rest}>
        {loading ? "…" : children}
      </BaseDepthButton>
    );
    if (!tooltip) return btn;
    const tipProps = typeof tooltip === "string" ? { label: tooltip } : tooltip;
    return <Tooltip {...tipProps}>{btn}</Tooltip>;
  },
);
DepthButton.displayName = "DepthButton";
