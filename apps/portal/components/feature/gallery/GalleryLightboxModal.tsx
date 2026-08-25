import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@portal/components/icons";
import { Dialog, DialogContent } from "@portal/components/ui/dialog";
import { useEffect, useRef } from "react";
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
  resolveImageUrl: (mediaId: string, variant?: "view" | "full") => string;
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
  const isOpen = open && item !== null;
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !(document.activeElement instanceof HTMLElement)) {
      return;
    }
    returnFocusRef.current = document.activeElement;
  }, [isOpen]);

  const closeLightbox = () => {
    const returnFocus = returnFocusRef.current;
    onClose();
    window.setTimeout(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus();
      }
    }, 0);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => { if (!nextOpen) closeLightbox(); }}>
      <DialogContent
        aria-label={t("modal.lightbox.title")}
        className="gallery-lb-content"
        overlayClassName="gallery-lb-overlay"
        showCloseButton={false}
      >
        {item ? (
          <div className="gallery-lb">
            <button
              type="button"
              className="gallery-lb__close"
              onClick={closeLightbox}
              aria-label={t("common:action.close")}
              autoFocus
            >
              <XIcon size={20} />
            </button>

            <button
              type="button"
              className="gallery-lb__nav gallery-lb__nav--prev"
              onClick={onPrev}
              aria-label={t("aria.prevItem")}
            >
              <ChevronLeftIcon size={28} />
            </button>
            <button
              type="button"
              className="gallery-lb__nav gallery-lb__nav--next"
              onClick={onNext}
              aria-label={t("aria.nextItem")}
            >
              <ChevronRightIcon size={28} />
            </button>

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
                    src={resolveImageUrl(item.media_id, "full")}
                    alt={item.caption ?? item.id}
                    loading="lazy"
                    decoding="async"
                    className="gallery-lb__img"
                    style={{ transform: `scale(${zoom})` }}
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

            <div className="gallery-lb__info">
              <div className="gallery-lb__caption-wrap">
                {item.caption ? <p className="gallery-lb__caption">{item.caption}</p> : null}
              </div>
              <div className="gallery-lb__metadata">
                {!isExternalView ? (
                  <span className="gallery-lb__uploader">{item.uploaded_by_name ?? item.uploaded_by}</span>
                ) : null}
                <time className="gallery-lb__date" dateTime={item.created_at}>
                  {formatDateTime(item.created_at)}
                </time>
                <span className="gallery-lb__count">{Math.max(1, index + 1)} / {total}</span>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
