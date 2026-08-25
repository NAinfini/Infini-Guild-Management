import type { WikiArticle } from "@guild/shared";
import { ArchiveIcon, PencilIcon, PinIcon, PlusIcon } from "@portal/components/icons";
import { Alert, AlertDescription } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import type { ReactNode } from "react";
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
  articles: WikiArticle[];
  selectedSlug: string | null;
  emptyTitle: ReactNode;
  onSelectArticle: (slug: string) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

function ArticleStatusHint({
  label,
  title,
  description,
  children,
  tone,
}: {
  label: string;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  tone: "brand" | "muted";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={`wiki-article-status-icon wiki-article-status-icon--${tone}`} aria-label={label} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="wiki-article-status-tooltip" side="top">
        <span className="wiki-article-status-tooltip__title">{title}</span>
        <span className="wiki-article-status-tooltip__description">{description}</span>
      </TooltipContent>
    </Tooltip>
  );
}

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
  articles,
  selectedSlug,
  emptyTitle,
  onSelectArticle,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: WikiArticleListCardProps) {
  const { t } = useTranslation("wiki");

  return (
    <Card className="wiki-article-list-card">
      <div className="wiki-card-body">
        <header className="wiki-card-header">
          <h2 className="wiki-card-title">{title}</h2>
          {canCreateArticle || canManageCategories ? (
            <div className="wiki-card-header-actions">
              {canCreateArticle ? (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        size="icon-lg"
                        className="wiki-header-action"
                        onClick={onCreateArticle}
                        aria-label={t("articleEditor.create")}
                      />
                    )}
                  >
                    <PlusIcon size={16} aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>{createLabel}</TooltipContent>
                </Tooltip>
              ) : null}
              {canManageCategories ? (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        className="wiki-header-action"
                        onClick={onOpenCategoryEditor}
                        aria-label={t("editor.editCategories")}
                      />
                    )}
                  >
                    <PencilIcon size={16} aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>{t("editor.editCategories")}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : null}
        </header>
        <div className="wiki-card-scroll wiki-article-list-scroll">
          {isLoading ? (
            <div className="wiki-list-skeletons" aria-busy="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="wiki-list-skeleton" />
              ))}
            </div>
          ) : null}
          {isError ? (
            <Alert variant="destructive">
              <AlertDescription>{warningMessage}</AlertDescription>
            </Alert>
          ) : null}
          {!isLoading && !isError ? (
            <div className="wiki-article-list">
              {articles.length === 0 ? (
                <EmptyState
                  title={emptyTitle}
                  actions={hasActiveFilters ? (
                    <Button type="button" onClick={onResetFilters}>{resetFiltersLabel}</Button>
                  ) : categoryOptions.length === 0 && canManageCategories ? (
                    <Button type="button" onClick={onOpenCategoryEditor}>
                      {t("editor.editCategories")}
                    </Button>
                  ) : canCreateArticle && categoryOptions.length > 0 ? (
                    <Button type="button" onClick={onCreateArticle}>
                      {createLabel}
                    </Button>
                  ) : undefined}
                />
              ) : null}
              {articles.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`wiki-article-item ${item.slug === selectedSlug ? "wiki-article-item--active" : ""}`}
                  onClick={() => onSelectArticle(item.slug)}
                  aria-label={t("aria.openArticle", { title: item.title })}
                  aria-pressed={item.slug === selectedSlug}
                >
                  <span className="wiki-article-item__title-row">
                    <span className="wiki-article-item__title">{item.title}</span>
                    {item.pinned ? (
                      <ArticleStatusHint
                        label={t("hovercard.pinned.title")}
                        title={t("hovercard.pinned.title")}
                        description={t("hovercard.pinned.desc")}
                        tone="brand"
                      >
                        <PinIcon size={14} aria-hidden="true" />
                      </ArticleStatusHint>
                    ) : null}
                    {item.archived_at ? (
                      <ArticleStatusHint
                        label={t("hovercard.archived.title")}
                        title={t("hovercard.archived.title")}
                        description={t("hovercard.archived.desc")}
                        tone="muted"
                      >
                        <ArchiveIcon size={14} aria-hidden="true" />
                      </ArticleStatusHint>
                    ) : null}
                  </span>
                  <span className="wiki-article-item__meta">
                    {formatDateTimeWithTimeZone(item.updated_at)}
                    {item.updated_by_display_name ? ` · ${item.updated_by_display_name}` : null}
                  </span>
                </button>
              ))}
              {hasMore && onLoadMore ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={isLoadingMore}
                  onClick={onLoadMore}
                  className="wiki-load-more"
                >
                  {t("action.loadMore")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
