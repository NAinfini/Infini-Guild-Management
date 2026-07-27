import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@portal/components/icons";
import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GalleryItem } from "./shared";

type GalleryLightboxModalProps = {
  open: boolean;
  item: GalleryItem | null;
  index: number;
  total: number;
  zoom: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  setZoom: (next: number | ((value: number) => number)) => void;
  resolveImageUrl: (key: string) => string;
  toEmbedVideoUrl: (value: string) => string;
  formatDateTime: (iso: string) => string;
  isExternalView: boolean;
};

export function GalleryLightboxModal({
  open,
  item,
  index,
  total,
  zoom,
  onClose,
  onPrev,
  onNext,
  setZoom,
  resolveImageUrl,
  toEmbedVideoUrl,
  formatDateTime,
  isExternalView,
}: GalleryLightboxModalProps) {
  const { t } = useTranslation("gallery");

  if (!open || !item) return null;

  return (
    <div className="gallery-lb-overlay" onClick={onClose}>
      <div className="gallery-lb" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button type="button" className="gallery-lb__close" onClick={onClose} aria-label={t("common:close")}>
          <XIcon size={20} />
        </button>

        {/* Prev / Next nav */}
        <button type="button" className="gallery-lb__nav gallery-lb__nav--prev" onClick={onPrev} aria-label={t("aria.prevItem")}>
          <ChevronLeftIcon size={28} />
        </button>
        <button type="button" className="gallery-lb__nav gallery-lb__nav--next" onClick={onNext} aria-label={t("aria.nextItem")}>
          <ChevronRightIcon size={28} />
        </button>

        {/* Media */}
        <div className="gallery-lb__media">
          {item.type === "image" ? (
            <div
              className="gallery-lb__img-wrap"
              onWheel={(event) => {
                event.preventDefault();
                const direction = event.deltaY < 0 ? 0.12 : -0.12;
                setZoom((value) => Math.min(2.6, Math.max(1, Number((value + direction).toFixed(2)))));
              }}
              onDoubleClick={() => setZoom((value) => (value > 1 ? 1 : 2.2))}
              style={{ cursor: zoom > 1 ? "zoom-out" : "zoom-in" }}
            >
              <img
                src={resolveImageUrl(item.url)}
                alt={item.caption ?? item.id}
                loading="lazy"
                decoding="async"
                className="gallery-lb__img"
                style={{
                  transform: `scale(${zoom})`,
                }}
              />
            </div>
          ) : (
            <iframe
              src={toEmbedVideoUrl(item.url)}
              title={item.caption ?? item.id}
              className="gallery-lb__video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>

        {/* Bottom info bar */}
        <div className="gallery-lb__info">
          <Group gap={12} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            {item.caption ? (
              <Text size="sm" fw={600} truncate className="gallery-lb__caption">
                {item.caption}
              </Text>
            ) : null}
          </Group>
          <Group gap={16} wrap="nowrap">
            {!isExternalView ? (
              <Text size="xs" className="gallery-lb__uploader">
                {item.uploaded_by_name ?? item.uploaded_by}
              </Text>
            ) : null}
            <Text size="xs" className="gallery-lb__date">
              {formatDateTime(item.created_at)}
            </Text>
            <Text size="xs" fw={500} className="gallery-lb__count">
              {Math.max(1, index + 1)} / {total}
            </Text>
          </Group>
        </div>
      </div>
    </div>
  );
}
