import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@portal/utils/cn";

type ButtonState = "idle" | "loading" | "success" | "error";

export interface ProgressButtonProps {
  children: ReactNode;
  className?: string;
  /** Required when `children` is an icon only — otherwise the button has no accessible name. */
  ariaLabel?: string;
  disabled?: boolean;
  onPress?: () => Promise<void>;
  onClick?: () => void;
  loadingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  indicator?: string;
  loading?: boolean;
  progress?: number;
}

export function ProgressButton({
  children,
  className,
  ariaLabel,
  disabled,
  onPress,
  onClick,
  loadingLabel,
  successLabel,
  errorLabel,
  loading: externalLoading,
  progress,
}: ProgressButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");

  const handleClick = useCallback(async () => {
    if (onClick) {
      onClick();
      return;
    }
    if (!onPress) return;
    setState("loading");
    try {
      await onPress();
      setState("success");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }, [onPress, onClick]);

  const isLoading = externalLoading || state === "loading";
  const label =
    state === "loading" ? loadingLabel :
    state === "success" ? successLabel :
    state === "error" ? errorLabel :
    null;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled || isLoading}
      onClick={() => void handleClick()}
      className={cn(
        // The -500 shades put white labels at 2.3–3.7:1; the darker steps clear 4.5.
        "relative inline-flex items-center justify-center overflow-hidden rounded-md px-4 py-2 text-sm font-medium",
        "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors",
        state === "success" && "bg-green-700 hover:bg-green-800",
        state === "error" && "bg-red-600 hover:bg-red-700",
        className,
      )}
    >
      {typeof progress === "number" && (
        <div
          className="absolute left-0 top-0 h-full bg-blue-600/40 transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      )}
      <span className="relative z-10 flex items-center gap-2">
        {isLoading && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        )}
        {label ?? children}
      </span>
    </button>
  );
}
