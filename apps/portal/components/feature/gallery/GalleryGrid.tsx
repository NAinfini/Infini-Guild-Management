import { ActionIcon, Button, Checkbox, Group, Paper, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { TrashIcon, PlayIcon } from "@portal/components/icons";
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
  deletePending: boolean;
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
  onDelete: (id: string) => void;
  onOpenLightbox: (id: string) => void;
  resolveImageUrl: (key: string) => string;
  formatDateTime: (iso: string) => string;
  actionDeleteLabel: string;
};

export function GalleryGrid({
  rows,
  isLoading,
  isError,
  isExternalView,
  canModerate,
  selectedIds,
  deletePending,
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
      <div className="gallery-masonry" role="list" aria-label={t("aria.galleryLoading")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} role="listitem" className="gallery-masonry__item">
            <Paper withBorder radius="md" className="gallery-card">
              <div className="gallery-card__inner">
                <Skeleton height={200} radius={8} />
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
   * list/listitem, not grid/gridcell: role="grid" requires role="row"
   * children, and a masonry wall has no column semantics to navigate.
   */
  return (
    <div className="gallery-masonry" role="list" aria-label={t("aria.galleryItems")}>
      {rows.map((item) => (
          <div key={item.id} className="gallery-masonry__item" role="listitem">
            <Paper withBorder radius="md" className="gallery-card">
              <div>
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
                    <div className="gallery-video-thumb">
                      <PlayIcon size={40} />
                    </div>
                  )}
                  {!isExternalView ? (
                    <span className="gallery-preview-uploader">{item.uploaded_by_name ?? item.uploaded_by}</span>
                  ) : null}
                </div>
              </button>
              <div className="gallery-card__footer">
                <div className="gallery-card__meta">
                  <Text size="sm" fw={600} lineClamp={1}>{item.caption ?? "-"}</Text>
                  <Text size="xs" c="dimmed">{formatDateTime(item.created_at)}</Text>
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
                          onDelete(item.id);
                        }}
                        loading={deletePending}
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
