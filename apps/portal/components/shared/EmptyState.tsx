import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle } from "@tabler/icons-react";
import { memo, type ReactNode } from "react";

type EmptyStateStatus = "info" | "success" | "error" | "warning";

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  status?: EmptyStateStatus;
  subTitle?: ReactNode;
  extra?: ReactNode;
};

const statusIcon: Record<EmptyStateStatus, ReactNode> = {
  info: <IconInfoCircle size={40} stroke={1.5} />,
  success: <IconCircleCheck size={40} stroke={1.5} />,
  error: <IconCircleX size={40} stroke={1.5} />,
  warning: <IconAlertTriangle size={40} stroke={1.5} />,
};

export const EmptyState = memo(function EmptyState({
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
    <div aria-live="polite" className="empty-state">
      <div className={`empty-state__icon empty-state__icon--${status}`}>
        {statusIcon[status]}
      </div>
      <h3 className="empty-state__title">{title}</h3>
      {desc && <p className="empty-state__description">{desc}</p>}
      {act && <div className="empty-state__actions">{act}</div>}
    </div>
  );
});
