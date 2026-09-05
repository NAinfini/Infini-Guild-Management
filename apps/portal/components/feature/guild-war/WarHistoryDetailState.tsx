import { Alert } from "@portal/components/ui/alert";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
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
        <LoadingIndicator />
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
