import { AlertTriangleIcon, CircleCheckIcon, CircleXIcon, InfoCircleIcon } from "@portal/components/icons";
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
  info: <InfoCircleIcon size={40} />,
  success: <CircleCheckIcon size={40} />,
  error: <CircleXIcon size={40} />,
  warning: <AlertTriangleIcon size={40} />,
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
      {/*
        * Not a heading: the panel this sits in has no <h2>, so an <h3> skipped a
        * level in the document outline. The text is already announced through the
        * aria-live region above, so it needs no place in the heading tree.
        */}
      <div className="empty-state__title">{title}</div>
      {desc && <p className="empty-state__description">{desc}</p>}
      {act && <div className="empty-state__actions">{act}</div>}
    </div>
  );
});
