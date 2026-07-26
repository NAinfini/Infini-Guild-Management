import { RevealOnScroll } from "@portal/components/effects";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { Button, Checkbox, Group, Skeleton, Stack, Text } from "@mantine/core";
import { TrashIcon, PlayIcon } from "@portal/components/icons";
import type { CSSProperties } from "react";
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
  disableResetFilters: boolean;
  resetFiltersLabel: string;
  onResetFilters: () => void;
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
  disableResetFilters,
  resetFiltersLabel,
  onResetFilters,
  onToggleSelect,
  onDelete,
  onOpenLightbox,
  resolveImageUrl,
  formatDateTime,
  actionDeleteLabel,
}: GalleryGridProps) {
  const { t } = useTranslation("gallery");
  if (isLoading && rows.length === 0) {
    return (
      <div className="gallery-masonry" role="list" aria-label={t("aria.galleryLoading")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} role="listitem" className="gallery-masonry__item">
            <PortalCard interactive={false}>
              <div className="gallery-card__inner">
                <Skeleton height={200} radius={8} />
                <Stack gap={4} mt={8}>
                  <Skeleton height={12} width="70%" />
                  <Skeleton height={10} width="40%" />
                </Stack>
              </div>
            </PortalCard>
          </div>
        ))}
      </div>
    );
  }

  if (isError && rows.length === 0) {
    return (
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <EmptyState title={errorTitle} />
        </div>
      </PortalCard>
    );
  }

  if (rows.length === 0) {
    return (
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            actions={
              <Button onClick={onResetFilters} disabled={disableResetFilters}>
                {resetFiltersLabel}
              </Button>
            }
          />
        </div>
      </PortalCard>
    );
  }

  /*
   * list/listitem, not grid/gridcell: role="grid" requires role="row"
   * children, and a masonry wall has no column semantics to navigate.
   */
  return (
    <div className="gallery-masonry" role="list" aria-label={t("aria.galleryItems")}>
      {rows.map((item, index) => (
        <RevealOnScroll key={item.id} delayMs={Math.min(index, 18) * 18}>
          <div
            className="gallery-masonry__item gallery-masonry__item--animated"
            role="listitem"
            style={{ "--stagger-index": index } as CSSProperties}
          >
            <PortalCard className="gallery-card" interactive={false}>
              <button
                type="button"
                onClick={() => onOpenLightbox(item.id)}
                className="gallery-preview-button"
                aria-label={t(item.type === "image" ? "aria.openImage" : "aria.openVideo", { name: item.caption ?? item.id })}
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
                    <Checkbox
                      size="xs"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => onToggleSelect(item.id)}
                      aria-label={t("aria.selectItem", { id: item.id })}
                    />
                    <DepthButton type="danger" size="sm" iconOnly before={<TrashIcon size={14} />} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(item.id); }} loading={deletePending} tooltip={{ label: actionDeleteLabel, withArrow: true }} />
                  </Group>
                ) : null}
              </div>
            </PortalCard>
          </div>
        </RevealOnScroll>
      ))}
    </div>
  );
}
