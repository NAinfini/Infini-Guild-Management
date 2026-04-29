import type { ReactNode } from "react";
import { cn } from "@portal/utils/cn";

type EmptyStateStatus = "info" | "success" | "error" | "warning";

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  status?: EmptyStateStatus;
  /** Backward-compat aliases for Result component. */
  subTitle?: ReactNode;
  extra?: ReactNode;
};

const statusColor: Record<EmptyStateStatus, string> = {
  info: "text-blue-500",
  success: "text-green-500",
  error: "text-red-500",
  warning: "text-amber-500",
};

export function EmptyState({
  title,
  description,
  actions,
  status = "info",
  subTitle,
  extra,
}: EmptyStateProps) {
  const desc = description ?? subTitle;
  const act = actions ?? extra;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className={cn("mb-3 text-4xl", statusColor[status])}>
        {status === "success" && "✓"}
        {status === "error" && "✗"}
        {status === "warning" && "⚠"}
        {status === "info" && "ℹ"}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {desc && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{desc}</p>}
      {act && <div className="mt-4">{act}</div>}
    </div>
  );
}
