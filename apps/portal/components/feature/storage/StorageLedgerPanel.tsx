import type { StorageTransaction } from "@guild/shared";
import { ChevronLeftIcon, ChevronRightIcon } from "@portal/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { useStorageTransactions } from "@portal/hooks/useStorage";
import { formatLocaleDateTime } from "@portal/utils/datetime";
import { buildVisiblePages } from "@portal/utils/pagination";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type StorageLedgerPanelProps = {
  headingId: string;
  storageId?: string;
  itemId?: string;
  enabled?: boolean;
  subtitle?: string;
  className?: string;
  showHeading?: boolean;
};

function txClassName(type: StorageTransaction["type"]): string {
  if (type === "intake") return "storage-ledger-row--intake";
  if (type === "distribute") return "storage-ledger-row--distribute";
  return "storage-ledger-row--adjust";
}

export function StorageLedgerPanel({
  headingId,
  storageId,
  itemId,
  enabled = true,
  subtitle,
  className,
  showHeading = true,
}: StorageLedgerPanelProps) {
  const { t } = useTranslation("storage");
  const { t: tCommon } = useTranslation("common");
  const scopeKey = storageId ? `storage:${storageId}` : itemId ? `item:${itemId}` : "all";
  const [pagination, setPagination] = useState({ scopeKey, page: 1 });
  const ledgerPage = pagination.scopeKey === scopeKey ? pagination.page : 1;
  const setLedgerPage = (next: number | ((page: number) => number)) => {
    setPagination((current) => {
      const currentPage = current.scopeKey === scopeKey ? current.page : 1;
      return {
        scopeKey,
        page: typeof next === "function" ? next(currentPage) : next,
      };
    });
  };
  const transactionParams = {
    ...(storageId ? { storageId } : {}),
    ...(itemId ? { itemId } : {}),
    page: ledgerPage,
    limit: 20,
    enabled,
  };
  const transactionsQuery = useStorageTransactions(transactionParams);
  const transactions = transactionsQuery.data?.data ?? [];
  const totalPages = transactionsQuery.data?.total_pages ?? 1;
  const hasLedgerData = transactionsQuery.data !== undefined;
  const blockingError = transactionsQuery.isError && !hasLedgerData;
  const txLabels = {
    intake: t("tx.intake"),
    distribute: t("tx.distribute"),
    adjust: t("tx.adjust"),
  };

  useEffect(() => {
    if (pagination.scopeKey !== scopeKey) setPagination({ scopeKey, page: 1 });
  }, [pagination.scopeKey, scopeKey]);

  return (
    <section
      className={`storage-detail__ledger storage-ledger-panel${className ? ` ${className}` : ""}`}
      aria-labelledby={headingId}
    >
      {showHeading || transactionsQuery.isFetching ? (
        <div className={`storage-detail__ledger-heading${showHeading ? "" : " storage-detail__ledger-heading--status-only"}`}>
          {showHeading ? (
            <div className="storage-detail__ledger-copy">
              <strong id={headingId}>{t("ledger.title")}</strong>
              <span>{subtitle ?? t("ledger.subtitle")}</span>
            </div>
          ) : null}
          {transactionsQuery.isFetching ? (
            <span
              className="storage-ledger__loading"
              role="status"
              aria-live="polite"
              aria-label={t("ledger.loading")}
            />
          ) : null}
        </div>
      ) : null}

      {transactionsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("ledger.error")}</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={() => void transactionsQuery.refetch()}>
              {tCommon("action.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!blockingError && transactions.length > 0 ? (
        <div className="storage-ledger">
          {transactions.map((tx) => (
            <div key={tx.id} className={`storage-ledger-row ${txClassName(tx.type)}`}>
              <div className="storage-ledger-row__main">
                <div className="storage-ledger-row__type">
                  <strong>{txLabels[tx.type]}</strong>
                  <strong className="storage-ledger-row__delta">
                    {tx.quantity_delta > 0 ? "+" : ""}{tx.quantity_delta}
                  </strong>
                </div>
                <div className="storage-ledger-row__meta">
                  <span className="storage-ledger-row__item">{tx.item_name ?? tx.item_id}</span>
                  <span className="storage-ledger-row__actor">
                    {tx.recipient_display_name ?? tx.actor_display_name ?? tx.actor_id}
                  </span>
                </div>
                {tx.note ? <p>{tx.note}</p> : null}
              </div>
              <span className="storage-ledger-row__date">
                {formatLocaleDateTime(tx.created_at, undefined, "numeric")}
              </span>
            </div>
          ))}
        </div>
      ) : !blockingError ? (
        <p className="storage-ledger__empty">{t("ledger.empty")}</p>
      ) : null}

      {!blockingError && totalPages > 1 ? (
        <nav className="storage-ledger-pagination" aria-label={t("ledger.title")}>
          <Button
            size="sm"
            variant="outline"
            aria-label={tCommon("pagination.prev")}
            disabled={ledgerPage <= 1}
            onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
          >
            <ChevronLeftIcon size={14} />
          </Button>
          {buildVisiblePages(ledgerPage, totalPages).map((page, index) => page === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="storage-ledger-pagination__ellipsis" aria-hidden>…</span>
          ) : (
            <Button
              key={page}
              size="sm"
              variant={page === ledgerPage ? "default" : "outline"}
              aria-label={tCommon("pagination.goToPage", { page })}
              aria-current={page === ledgerPage ? "page" : undefined}
              onClick={() => setLedgerPage(page)}
            >
              {page}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            aria-label={tCommon("pagination.next")}
            disabled={ledgerPage >= totalPages}
            onClick={() => setLedgerPage((page) => Math.min(totalPages, page + 1))}
          >
            <ChevronRightIcon size={14} />
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
