import { Alert } from "@portal/components/ui/alert";
import { Skeleton } from "@portal/components/ui/skeleton";
import { EmptyState } from "@portal/components/shared/EmptyState";

type WarHistoryDetailStateProps = {
  loading: boolean;
  error: boolean;
  errorMessage: string;
  empty: boolean;
  emptyTitle: string;
};

export function WarHistoryDetailState({
  loading,
  error,
  errorMessage,
  empty,
  emptyTitle,
}: WarHistoryDetailStateProps) {
  return (
    <>
      {loading ? (
        <div className="war-history-detail-panel__loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-18 w-full" />
          <Skeleton className="h-55 w-full" />
        </div>
      ) : null}
      {error ? <Alert variant="destructive">{errorMessage}</Alert> : null}
      {empty ? (
        <div className="whd-placeholder">
          <EmptyState title={emptyTitle} />
        </div>
      ) : null}
    </>
  );
}
