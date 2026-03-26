import { PlayCircleOutlined } from "@portal/utils/icons";
import { RevealOnScroll } from "@infini-dev-kit/react";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { Button, Checkbox, Group, Skeleton, Stack, Text } from "@mantine/core";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";
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
  isHttpUrl: (value: string) => boolean;
  formatDateTime: (iso: string) => string;
  actionDeleteLabel: string;
  fieldR2ObjectLabel: string;
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
  isHttpUrl,
  formatDateTime,
  actionDeleteLabel,
  fieldR2ObjectLabel,
}: GalleryGridProps) {
  const { t } = useTranslation("gallery");
  if (isLoading && rows.length === 0) {
    return (
      <div className="gallery-masonry" role="grid" aria-label={t("aria.galleryLoading")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="gallery-masonry__item">
            <PortalCard interactive={false}>
              <div style={{ padding: "1.2rem" }}>
                <Stack gap={8}>
                  <Skeleton height={12} width="40%" />
                  <Skeleton height={200} radius={8} />
                  <Skeleton height={12} width="70%" />
                  <Skeleton height={10} width="50%" />
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

  return (
    <div className="gallery-masonry" role="grid" aria-label={t("aria.galleryItems")}>
      {rows.map((item, index) => (
        <RevealOnScroll key={item.id} delayMs={Math.min(index, 18) * 18}>
          <div
            className="gallery-masonry__item gallery-masonry__item--animated"
            role="gridcell"
            style={{ "--stagger-index": index } as CSSProperties}
          >
            <PortalCard className="gallery-card" interactive={false}>
              <div style={{ padding: "1.2rem" }}>
                <Stack gap={8} style={{ width: "100%" }}>
                  <Text fw={600}>{item.type.toUpperCase()}</Text>
                  {canModerate ? (
                    <Group gap={8} wrap="wrap">
                      <Checkbox
                        checked={selectedIds.includes(item.id)}
                        onChange={() => onToggleSelect(item.id)}
                        aria-label={t("aria.selectItem", { id: item.id })}
                      />
                      <DepthButton type="danger" size="sm" before={<IconTrash size={16} />} onClick={() => onDelete(item.id)} loading={deletePending}>
                        {actionDeleteLabel}
                      </DepthButton>
                    </Group>
                  ) : null}
                  {item.type === "image" ? (
                    isHttpUrl(item.url) ? (
                      <button
                        type="button"
                        onClick={() => onOpenLightbox(item.id)}
                        className="gallery-preview-button"
                        aria-label={t("aria.openImage", { name: item.caption ?? item.id })}
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
                      aria-label={t("aria.openVideo", { name: item.caption ?? item.id })}
                    >
                      <div className="gallery-preview-media">
                        <span className="gallery-type-badge">
                          <PlayCircleOutlined /> {t("media.video")}
                        </span>
                        <div
                          className="gallery-video-thumbnail"
                          style={{
                            width: "100%",
                            height: 170,
                            borderRadius: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "var(--mantine-color-dark-6, #1a1a2e)",
                          }}
                        >
                          <IconPlayerPlay size={48} style={{ opacity: 0.7 }} />
                        </div>
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
            </PortalCard>
          </div>
        </RevealOnScroll>
      ))}
    </div>
  );
}

