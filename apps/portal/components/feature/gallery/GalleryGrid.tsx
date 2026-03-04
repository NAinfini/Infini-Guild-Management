import { PlayCircleOutlined } from "@portal/utils/icons";
import { RevealOnScroll } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { CSSProperties } from "react";
import { EmptyState } from "../../shared/EmptyState";
import type { GalleryItem } from "./shared";

type GalleryGridProps = {
  rows: GalleryItem[];
  isExternalView: boolean;
  canModerate: boolean;
  selectedIds: string[];
  deletePending: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  disableResetFilters: boolean;
  resetFiltersLabel: string;
  onResetFilters: () => void;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenLightbox: (id: string) => void;
  isHttpUrl: (value: string) => boolean;
  toEmbedVideoUrl: (value: string) => string;
  formatDateTime: (iso: string) => string;
  actionDeleteLabel: string;
  fieldR2ObjectLabel: string;
};

export function GalleryGrid({
  rows,
  isExternalView,
  canModerate,
  selectedIds,
  deletePending,
  emptyTitle,
  emptyDescription,
  disableResetFilters,
  resetFiltersLabel,
  onResetFilters,
  onToggleSelect,
  onDelete,
  onOpenLightbox,
  isHttpUrl,
  toEmbedVideoUrl,
  formatDateTime,
  actionDeleteLabel,
  fieldR2ObjectLabel,
}: GalleryGridProps) {
  if (rows.length === 0) {
    return (
      <InfiniCard>
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
      </InfiniCard>
    );
  }

  return (
    <div className="gallery-masonry" role="grid" aria-label="Gallery items">
      {rows.map((item, index) => (
        <RevealOnScroll key={item.id} delayMs={Math.min(index, 18) * 18}>
          <div
            className="gallery-masonry__item gallery-masonry__item--animated"
            role="gridcell"
            style={{ "--stagger-index": index } as CSSProperties}
          >
            <InfiniCard className="gallery-card">
              <div style={{ padding: "1.2rem" }}>
                <Stack gap={8} style={{ width: "100%" }}>
                  <Text fw={600}>{item.type.toUpperCase()}</Text>
                  {canModerate ? (
                    <Group gap={8} wrap="wrap">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => onToggleSelect(item.id)}
                        aria-label={`Select gallery item ${item.id}`}
                      />
                      <Button color="red" size="xs" onClick={() => onDelete(item.id)} loading={deletePending}>
                        {actionDeleteLabel}
                      </Button>
                    </Group>
                  ) : null}
                  {item.type === "image" ? (
                    isHttpUrl(item.url) ? (
                      <button
                        type="button"
                        onClick={() => onOpenLightbox(item.id)}
                        className="gallery-preview-button"
                        aria-label={`Open image ${item.caption ?? item.id}`}
                      >
                        <div className="gallery-preview-media">
                          <img
                            src={item.url}
                            alt={item.caption ?? item.id}
                            loading="lazy"
                            decoding="async"
                            style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 8 }}
                          />
                          {!isExternalView ? (
                            <span className="gallery-preview-uploader">{item.uploaded_by_name ?? item.uploaded_by}</span>
                          ) : null}
                        </div>
                      </button>
                    ) : (
                      <div className="gallery-object-placeholder">
                        <Text c="dimmed">{fieldR2ObjectLabel}</Text>
                        <Text c="dimmed" style={{ wordBreak: "break-all" }}>
                          {item.url}
                        </Text>
                      </div>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenLightbox(item.id)}
                      className="gallery-preview-button"
                      aria-label={`Open video ${item.caption ?? item.id}`}
                    >
                      <div className="gallery-preview-media">
                        <span className="gallery-type-badge">
                          <PlayCircleOutlined /> VIDEO
                        </span>
                        <iframe
                          src={toEmbedVideoUrl(item.url)}
                          title={item.caption ?? item.id}
                          style={{ width: "100%", height: 170, border: "none", borderRadius: 8 }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        {!isExternalView ? (
                          <span className="gallery-preview-uploader">{item.uploaded_by_name ?? item.uploaded_by}</span>
                        ) : null}
                      </div>
                    </button>
                  )}
                  <Text fw={600}>{item.caption ?? "-"}</Text>
                  <Text c="dimmed" style={{ wordBreak: "break-all" }}>
                    {item.url}
                  </Text>
                  <Text c="dimmed">{formatDateTime(item.created_at)}</Text>
                </Stack>
              </div>
            </InfiniCard>
          </div>
        </RevealOnScroll>
      ))}
    </div>
  );
}
