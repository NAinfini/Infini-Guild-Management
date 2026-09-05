import type { AnnouncementSummary } from "@guild/shared";
import { PlusIcon } from "@portal/components/icons";
import { ContentPreviewCard } from "@portal/components/shared/ContentPreviewCard";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";

type AnnouncementListCardProps = {
  title: ReactNode;
  rows: AnnouncementSummary[];
  canCreate: boolean;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  onRetry: () => void;
  retryPending?: boolean;
  emptyText: ReactNode;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

export function AnnouncementListCard({
  title,
  rows,
  canCreate,
  isLoading,
  isError,
  warningMessage,
  onRetry,
  retryPending = false,
  emptyText,
  onSelect,
  onCreate,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: AnnouncementListCardProps) {
  const { t } = useTranslation("announcements");
  const isBlockingError = isError && rows.length === 0;
  const isRefreshError = isError && rows.length > 0;

  return (
    <Card className="announcements-catalog" role="region" aria-labelledby="announcements-catalog-title">
      <header className="announcements-catalog__header">
        <h2 id="announcements-catalog-title" className="announcements-catalog__title">{title}</h2>
        {canCreate && onCreate ? (
          <Button type="button" size="sm" onClick={onCreate}>
            <PlusIcon size={16} aria-hidden="true" />
            {t("action.newAnnouncement")}
          </Button>
        ) : null}
      </header>

      {isLoading && rows.length === 0 ? (
        <LoadingIndicator />
      ) : null}
      {isBlockingError ? (
        <EmptyState
          status="error"
          title={warningMessage}
          actions={<Button loading={retryPending} onClick={onRetry}>{t("common:action.retry")}</Button>}
        />
      ) : null}
      {isRefreshError ? (
        <Alert variant="destructive">
          <AlertTitle>{warningMessage}</AlertTitle>
          <Button type="button" size="sm" variant="outline" loading={retryPending} onClick={onRetry}>
            {t("common:action.retry")}
          </Button>
        </Alert>
      ) : null}
      {!isLoading && !isBlockingError ? rows.length > 0 ? (
        <div className="announcements-preview-list">
          {rows.map((item) => (
            <ContentPreviewCard
              key={item.id}
              domain="announcements"
              title={item.title}
              excerpt={item.excerpt}
              category={t(`category.${item.category}`)}
              author={item.author.display_name}
              timestamp={formatDateTimeWithTimeZone(item.publish_at ?? item.created_at)}
              viewLabel={t("meta.views", { count: item.view_count })}
              imageUrl={item.preview_media_id ? resolveMediaUrl(item.preview_media_id) : null}
              pinned={item.pinned}
              pinnedLabel={t("status.pinned")}
              archived={item.status === "archived"}
              archivedLabel={t("status.archived")}
              ariaLabel={t("aria.openAnnouncement", { title: item.title })}
              onOpen={() => onSelect(item.id)}
            />
          ))}
          {hasMore && onLoadMore ? (
            <Button
              type="button"
              variant="outline"
              loading={isLoadingMore}
              onClick={onLoadMore}
              className="announcements-list__load-more"
            >
              {t("action.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : emptyText : null}
    </Card>
  );
}
