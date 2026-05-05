import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ActionIcon, Button, Tooltip, type TooltipProps } from "@mantine/core";

type ToggleVariant = "primary" | "secondary" | "danger" | "success" | "warning" | "info";
type ToggleSize = "xs" | "sm" | "md" | "lg";

type TooltipConfig = string | Omit<TooltipProps, "children">;

export interface DepthToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onToggle" | "color"> {
  type?: ToggleVariant;
  size?: ToggleSize;
  pressed?: boolean;
  onToggle?: (nextPressed: boolean) => void;
  before?: ReactNode;
  after?: ReactNode;
  iconOnly?: boolean;
  tooltip?: TooltipConfig;
}

const variantColor: Record<ToggleVariant, string> = {
  primary: "blue",
  secondary: "gray",
  danger: "red",
  success: "green",
  warning: "yellow",
  info: "cyan",
};

export const DepthToggle = forwardRef<HTMLButtonElement, DepthToggleProps>(
  (
    {
      type = "primary",
      size = "md",
      pressed = false,
      onToggle,
      before,
      after,
      iconOnly,
      tooltip,
      className,
      children,
      onClick,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const color = variantColor[type];

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onToggle?.(!pressed);
      onClick?.(e);
    };

    const tooltipLabel = typeof tooltip === "string" ? tooltip : tooltip?.label;

    const inner = iconOnly ? (
      <ActionIcon
        ref={ref}
        variant={pressed ? "filled" : "subtle"}
        color={pressed ? color : "gray"}
        size={size}
        disabled={disabled}
        onClick={handleClick}
        aria-pressed={pressed}
        className={className}
        {...rest}
      >
        {children}
      </ActionIcon>
    ) : (
      <Button
        ref={ref}
        variant={pressed ? "filled" : "default"}
        color={color}
        size={size}
        disabled={disabled}
        onClick={handleClick}
        leftSection={before}
        rightSection={after}
        aria-pressed={pressed}
        className={className}
        {...rest}
      >
        {children}
      </Button>
    );

    if (!tooltipLabel) return inner;
    const tipProps = typeof tooltip === "string" ? { label: tooltip } : tooltip!;
    return <Tooltip {...tipProps}>{inner}</Tooltip>;
  },
);
DepthToggle.displayName = "DepthToggle";
