import { getVideoThumbnailUrl } from "@guild/shared/utils/video";
import { TrashIcon, PlayIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Checkbox } from "@portal/components/ui/checkbox";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useKeyedPending } from "@portal/hooks/useKeyedPending";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { RecoverableImage } from "../../shared/RecoverableImage";
import { GalleryLikeButton } from "./GalleryLikeButton";
import type { GalleryItem } from "./shared";

type GalleryGridProps = {
  rows: GalleryItem[];
  isLoading: boolean;
  isError: boolean;
  isExternalView: boolean;
  canModerate: boolean;
  canLike: boolean;
  selectedIds: string[];
  emptyTitle: string;
  emptyDescription?: string;
  errorTitle: string;
  errorDescription: string;
  retryLabel: string;
  retryPending: boolean;
  hasActiveFilters: boolean;
  canUpload: boolean;
  resetFiltersLabel: string;
  addMediaLabel: string;
  onRetry: () => void;
  onResetFilters: () => void;
  onAddMedia: () => void;
  onToggleSelect: (id: string) => void;
  onDelete: (item: GalleryItem) => Promise<boolean>;
  onToggleLike: (id: string, liked: boolean) => Promise<boolean>;
  onOpenLightbox: (id: string, trigger: HTMLButtonElement) => void;
  resolveImageUrl: (mediaId: string, variant?: "view" | "full") => string;
  formatDateTime: (iso: string) => string;
  actionDeleteLabel: string;
};

type GalleryVideoPreviewProps = {
  url: string;
};

function GalleryVideoPreview({ url }: GalleryVideoPreviewProps) {
  const thumbnailUrl = getVideoThumbnailUrl(url);
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);

  if (thumbnailUrl && failedThumbnailUrl !== thumbnailUrl) {
    return (
      <>
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="gallery-preview-img"
          onError={() => setFailedThumbnailUrl(thumbnailUrl)}
        />
        <span className="gallery-video-cover-play" aria-hidden="true">
          <PlayIcon size={20} />
        </span>
      </>
    );
  }

  return (
    <div className="gallery-video-thumb">
      <span className="gallery-video-thumb__mark" aria-hidden="true">
        <PlayIcon size={28} />
      </span>
    </div>
  );
}

export function GalleryGrid({
  rows,
  isLoading,
  isError,
  isExternalView,
  canModerate,
  canLike,
  selectedIds,
  emptyTitle,
  emptyDescription,
  errorTitle,
  errorDescription,
  retryLabel,
  retryPending,
  hasActiveFilters,
  canUpload,
  resetFiltersLabel,
  addMediaLabel,
  onRetry,
  onResetFilters,
  onAddMedia,
  onToggleSelect,
  onDelete,
  onToggleLike,
  onOpenLightbox,
  resolveImageUrl,
  formatDateTime,
  actionDeleteLabel,
}: GalleryGridProps) {
  const { t } = useTranslation("gallery");
  const { pendingKeys, runPending } = useKeyedPending();
  const getOpenLabel = (item: GalleryItem) => {
    const name = item.title || item.id;
    if (isExternalView) {
      return t(item.type === "image" ? "aria.openImage" : "aria.openVideo", { name });
    }
    return t(item.type === "image" ? "aria.openImageBy" : "aria.openVideoBy", {
      name,
      uploader: item.uploaded_by_name ?? item.uploaded_by,
    });
  };

  if (isLoading && rows.length === 0) {
    return (
      <div className="gallery-grid" role="list" aria-label={t("aria.galleryLoading")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} role="listitem" className="gallery-grid__item">
            <Card className="gallery-card">
              <div className="gallery-card__inner">
                <Skeleton className="gallery-card__skeleton-media" />
                <div className="gallery-card__skeleton-copy">
                  <Skeleton className="gallery-card__skeleton-title" />
                  <Skeleton className="gallery-card__skeleton-meta" />
                </div>
              </div>
            </Card>
          </div>
        ))}
      </div>
    );
  }

  if (isError && rows.length === 0) {
    return (
      <Card className="gallery-grid__state">
        <EmptyState
            status="error"
            title={errorTitle}
            description={errorDescription}
            actions={
              <Button onClick={onRetry} loading={retryPending}>
                {retryLabel}
              </Button>
            }
        />
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="gallery-grid__state">
        <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            actions={
              hasActiveFilters ? (
                <Button onClick={onResetFilters}>
                  {resetFiltersLabel}
                </Button>
              ) : canUpload ? (
                <Button onClick={onAddMedia}>{addMediaLabel}</Button>
              ) : undefined
            }
        />
      </Card>
    );
  }

  /*
   * Keep list/listitem semantics: the visual rows follow this DOM order, while
   * role="grid" would require row wrappers and spreadsheet-style interaction.
   */
  return (
    <div className="gallery-grid" role="list" aria-label={t("aria.galleryItems")}>
      {rows.map((item) => (
        <div
          key={item.id}
          className="gallery-grid__item"
          role="listitem"
          data-gallery-id={item.id}
        >
          <Card className="gallery-card">
            <div className="gallery-card__inner">
              <button
                type="button"
                onClick={(event) => onOpenLightbox(item.id, event.currentTarget)}
                className="gallery-preview-button"
                aria-label={getOpenLabel(item)}
              >
                <div className="gallery-preview-media">
                  {item.type === "image" ? (
                    <RecoverableImage
                      source={resolveImageUrl(item.media_id)}
                      alt={item.title || item.id}
                      loading="lazy"
                      decoding="async"
                      className="gallery-preview-img"
                      fallbackClassName="gallery-preview-image-fallback"
                      failureLabel={t("common:media.imageUnavailable")}
                    />
                  ) : (
                    <>
                      <GalleryVideoPreview url={item.url} />
                      <span className="gallery-video-type-badge" aria-hidden="true">
                        {t("media.video")}
                      </span>
                    </>
                  )}
                  <span className="gallery-preview-copy">
                    <span className="gallery-preview-uploader">
                      {item.uploaded_by_name ?? item.uploaded_by}
                    </span>
                    <strong className="gallery-preview-title">{item.title || item.id}</strong>
                    {item.description ? (
                      <span className="gallery-preview-description">{item.description}</span>
                    ) : null}
                  </span>
                </div>
              </button>
              <div className="gallery-card__footer">
                <div className="gallery-card__meta">
                  <time className="gallery-card__date" dateTime={item.created_at}>
                    {formatDateTime(item.created_at)}
                  </time>
                </div>
                <div className="gallery-card__actions">
                  <GalleryLikeButton
                    liked={item.liked_by_viewer}
                    likeCount={item.like_count}
                    canLike={canLike}
                    loading={pendingKeys.has(`like:gallery:${item.id}`)}
                    className="gallery-like-button--card"
                    onToggle={() => {
                      void runPending(
                        `like:gallery:${item.id}`,
                        () => onToggleLike(item.id, item.liked_by_viewer),
                      );
                    }}
                  />
                  {canModerate ? (
                    <>
                      <label className="gallery-card__select-target">
                        <Checkbox
                          checked={selectedIds.includes(item.id)}
                          onCheckedChange={() => onToggleSelect(item.id)}
                          aria-label={t("aria.selectItem", { id: item.id })}
                        />
                      </label>
                      <Tooltip>
                        <TooltipTrigger
                          render={(
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon-lg"
                              className="gallery-card__delete"
                              aria-label={actionDeleteLabel}
                              loading={pendingKeys.has(`delete:gallery:${item.id}`)}
                            />
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            void runPending(`delete:gallery:${item.id}`, () => onDelete(item));
                          }}
                        >
                          <TrashIcon size={14} />
                        </TooltipTrigger>
                        <TooltipContent>{actionDeleteLabel}</TooltipContent>
                      </Tooltip>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
