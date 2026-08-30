import type { WikiArticle } from "@guild/shared";
import { PencilIcon, PlusIcon } from "@portal/components/icons";
import { ContentPreviewCard } from "@portal/components/shared/ContentPreviewCard";
import { Alert, AlertDescription } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";

type WikiArticleListCardProps = {
  title: ReactNode;
  canCreateArticle: boolean;
  canManageCategories: boolean;
  createLabel: ReactNode;
  onCreateArticle: () => void;
  onOpenCategoryEditor: () => void;
  categoryOptions: Array<{ value: string; label: string }>;
  hasActiveFilters: boolean;
  resetFiltersLabel: ReactNode;
  onResetFilters: () => void;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  onRetry: () => void;
  retryPending?: boolean;
  articles: WikiArticle[];
  selectedSlug: string | null;
  emptyTitle: ReactNode;
  onSelectArticle: (slug: string) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

export function WikiArticleListCard({
  title,
  canCreateArticle,
  canManageCategories,
  createLabel,
  onCreateArticle,
  onOpenCategoryEditor,
  categoryOptions,
  hasActiveFilters,
  resetFiltersLabel,
  onResetFilters,
  isLoading,
  isError,
  warningMessage,
  onRetry,
  retryPending = false,
  articles,
  emptyTitle,
  onSelectArticle,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: WikiArticleListCardProps) {
  const { t } = useTranslation("wiki");
  const isBlockingError = isError && articles.length === 0;
  const isRefreshError = isError && articles.length > 0;
  const categoryNames = useMemo(
    () => new Map(categoryOptions.map((option) => [option.value, option.label])),
    [categoryOptions],
  );

  return (
    <Card className="wiki-catalog" role="region" aria-labelledby="wiki-catalog-title">
      <header className="wiki-catalog__header">
        <div>
          <p className="wiki-catalog__eyebrow">{t("catalog.eyebrow")}</p>
          <h2 id="wiki-catalog-title" className="wiki-catalog__title">{title}</h2>
        </div>
        <div className="wiki-catalog__actions">
          {canManageCategories ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenCategoryEditor}>
              <PencilIcon size={15} aria-hidden="true" />
              {t("editor.editCategories")}
            </Button>
          ) : null}
          {canCreateArticle ? (
            <Button type="button" size="sm" onClick={onCreateArticle}>
              <PlusIcon size={15} aria-hidden="true" />
              {createLabel}
            </Button>
          ) : null}
        </div>
      </header>

      {isLoading && articles.length === 0 ? (
        <div className="wiki-preview-list" aria-busy="true">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="wiki-preview-skeleton" />)}
        </div>
      ) : null}
      {isBlockingError ? (
        <EmptyState
          status="error"
          title={warningMessage}
          actions={<Button type="button" loading={retryPending} onClick={onRetry}>{t("common:action.retry")}</Button>}
        />
      ) : null}
      {isRefreshError ? (
        <Alert variant="destructive">
          <AlertDescription>{warningMessage}</AlertDescription>
          <Button type="button" size="sm" variant="outline" loading={retryPending} onClick={onRetry}>
            {t("common:action.retry")}
          </Button>
        </Alert>
      ) : null}
      {!isLoading && !isBlockingError ? articles.length > 0 ? (
        <div className="wiki-preview-list">
          {articles.map((item) => (
            <ContentPreviewCard
              key={item.slug}
              domain="wiki"
              title={item.title}
              excerpt={item.excerpt}
              category={categoryNames.get(item.category_id) ?? t("articleEditor.categoryFallback")}
              author={item.updated_by_display_name ?? item.created_by.slice(0, 8)}
              timestamp={formatDateTimeWithTimeZone(item.updated_at)}
              viewLabel={t("meta.views", { count: item.view_count })}
              imageUrl={item.preview_media_id ? resolveMediaUrl(item.preview_media_id) : null}
              pinned={item.pinned}
              pinnedLabel={t("articleEditor.pinned")}
              archived={Boolean(item.archived_at)}
              archivedLabel={t("articleEditor.archived")}
              ariaLabel={t("aria.openArticle", { title: item.title })}
              onOpen={() => onSelectArticle(item.slug)}
            />
          ))}
          {hasMore && onLoadMore ? (
            <Button type="button" variant="outline" loading={isLoadingMore} onClick={onLoadMore}>
              {t("action.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={emptyTitle}
          actions={hasActiveFilters ? (
            <Button type="button" onClick={onResetFilters}>{resetFiltersLabel}</Button>
          ) : categoryOptions.length === 0 && canManageCategories ? (
            <Button type="button" onClick={onOpenCategoryEditor}>{t("editor.editCategories")}</Button>
          ) : canCreateArticle && categoryOptions.length > 0 ? (
            <Button type="button" onClick={onCreateArticle}>{createLabel}</Button>
          ) : undefined}
        />
      ) : null}
    </Card>
  );
}
