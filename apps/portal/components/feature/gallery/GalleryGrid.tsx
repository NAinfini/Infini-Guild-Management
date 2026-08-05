import { getVideoThumbnailUrl } from "@guild/shared/utils/video";
import { ActionIcon, Button, Checkbox, Group, Paper, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { TrashIcon, PlayIcon } from "@portal/components/icons";
import { useKeyedPending } from "@portal/hooks/useKeyedPending";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import type { GalleryItem } from "./shared";

type GalleryGridProps = {
  rows: GalleryItem[];
  isLoading: boolean;
  isError: boolean;
  isExternalView: boolean;
  canModerate: boolean;
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
  onDelete: (id: string) => Promise<boolean>;
  onOpenLightbox: (id: string) => void;
  resolveImageUrl: (key: string) => string;
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
  onOpenLightbox,
  resolveImageUrl,
  formatDateTime,
  actionDeleteLabel,
}: GalleryGridProps) {
  const { t } = useTranslation("gallery");
  const { pendingKeys, runPending } = useKeyedPending();
  const getOpenLabel = (item: GalleryItem) => {
    const name = item.caption ?? item.id;
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
            <Paper withBorder radius="md" className="gallery-card">
              <div className="gallery-card__inner">
                <Skeleton className="gallery-card__skeleton-media" radius={0} />
                <Stack gap={4} mt={8}>
                  <Skeleton height={12} width="70%" />
                  <Skeleton height={10} width="40%" />
                </Stack>
              </div>
            </Paper>
          </div>
        ))}
      </div>
    );
  }

  if (isError && rows.length === 0) {
    return (
      <Paper withBorder radius="md" p="var(--card-padding)">
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
      </Paper>
    );
  }

  if (rows.length === 0) {
    return (
      <Paper withBorder radius="md" p="var(--card-padding)">
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
      </Paper>
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
          <Paper withBorder radius="md" className="gallery-card">
            <div className="gallery-card__inner">
              <button
                type="button"
                onClick={() => onOpenLightbox(item.id)}
                className="gallery-preview-button"
                aria-label={getOpenLabel(item)}
              >
                <div className="gallery-preview-media">
                  {item.type === "image" ? (
                    <img
                      src={resolveImageUrl(item.url)}
                      alt={item.caption ?? item.id}
                      loading="lazy"
                      decoding="async"
                      className="gallery-preview-img"
                    />
                  ) : (
                    <>
                      <GalleryVideoPreview url={item.url} />
                      <span className="gallery-video-type-badge" aria-hidden="true">
                        {t("media.video")}
                      </span>
                    </>
                  )}
                  {!isExternalView ? (
                    <span className="gallery-preview-uploader">
                      {item.uploaded_by_name ?? item.uploaded_by}
                    </span>
                  ) : null}
                </div>
              </button>
              <div className="gallery-card__footer">
                <div className="gallery-card__meta">
                  <Text size="sm" fw={600} lineClamp={1}>
                    {item.caption ?? "-"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(item.created_at)}
                  </Text>
                </div>
                {canModerate ? (
                  <Group gap={6} wrap="nowrap" className="gallery-card__actions">
                    <label className="gallery-card__select-target">
                      <Checkbox
                        size="xs"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => onToggleSelect(item.id)}
                        aria-label={t("aria.selectItem", { id: item.id })}
                      />
                    </label>
                    <Tooltip label={actionDeleteLabel} withArrow>
                      <ActionIcon
                        color="red"
                        variant="light"
                        size="lg"
                        aria-label={actionDeleteLabel}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          void runPending(`delete:gallery:${item.id}`, () => onDelete(item.id));
                        }}
                        loading={pendingKeys.has(`delete:gallery:${item.id}`)}
                      >
                        <TrashIcon size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ) : null}
              </div>
            </div>
          </Paper>
        </div>
      ))}
    </div>
  );
}
