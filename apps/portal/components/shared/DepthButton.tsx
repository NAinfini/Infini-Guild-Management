import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ActionIcon, Button, Tooltip } from "@mantine/core";

type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "warning" | "info";
type ButtonSize = "xs" | "sm" | "md" | "lg";

type TooltipConfig = string | { label: ReactNode; withArrow?: boolean };

export interface DepthButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "color"> {
  type?: ButtonVariant;
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  size?: ButtonSize;
  before?: ReactNode;
  after?: ReactNode;
  loading?: boolean;
  tooltip?: TooltipConfig;
  iconOnly?: boolean;
}

// Brand-first mapping: the primary action wears the portal gold, and the two
// non-alarming accents use the bronze/copper ramps instead of Mantine's stock
// blue/cyan/yellow, which clash with the warm palette. Danger and success keep
// red/green because those meanings are conventional, not decorative.
const variantToMantine: Record<ButtonVariant, { color: string; variant: string }> = {
  primary: { color: "portal-gold", variant: "filled" },
  secondary: { color: "gray", variant: "default" },
  danger: { color: "red", variant: "filled" },
  success: { color: "green", variant: "filled" },
  warning: { color: "portal-copper", variant: "filled" },
  info: { color: "portal-bronze", variant: "light" },
};

export const DepthButton = forwardRef<HTMLButtonElement, DepthButtonProps>(
  (
    {
      type = "primary",
      htmlType = "button",
      size = "md",
      before,
      after,
      loading,
      disabled,
      tooltip,
      iconOnly,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const { color, variant } = variantToMantine[type];
    const tooltipLabel = typeof tooltip === "string" ? tooltip : tooltip?.label;

    const btn = iconOnly ? (
      <ActionIcon
        ref={ref}
        color={color}
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        className={className}
        aria-label={typeof tooltipLabel === "string" ? tooltipLabel : undefined}
        {...rest}
      >
        {before}
      </ActionIcon>
    ) : (
      <Button
        ref={ref}
        type={htmlType}
        color={color}
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        leftSection={before}
        rightSection={after}
        className={className}
        {...rest}
      >
        {children}
      </Button>
    );

    if (!tooltipLabel) return btn;
    const tipProps = typeof tooltip === "string" ? { label: tooltip } : tooltip!;
    return <Tooltip {...tipProps}>{btn}</Tooltip>;
  },
);
DepthButton.displayName = "DepthButton";
