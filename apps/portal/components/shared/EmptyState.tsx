import { Result } from "@infini-dev-kit/react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

export function EmptyState({ title, description, actions }: EmptyStateProps) {
  return (
    <Result
      status="info"
      title={title}
      subTitle={description}
      extra={actions}
    />
  );
}
