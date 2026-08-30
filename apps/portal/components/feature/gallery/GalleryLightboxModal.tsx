import { LIMITS } from "@guild/shared/config/limits";
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Dialog, DialogContent } from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Textarea } from "@portal/components/ui/textarea";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RecoverableImage } from "../../shared/RecoverableImage";
import { GalleryLikeButton } from "./GalleryLikeButton";
import type { GalleryItem } from "./shared";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.6;
const ZOOM_STEP = 0.12;

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
  canLike: boolean;
  likePending: boolean;
  onToggleLike: (id: string, liked: boolean) => Promise<boolean>;
  canEdit: boolean;
  updatePending: boolean;
  onUpdate: (
    item: GalleryItem,
    input: Readonly<{ title: string; description: string | null }>,
  ) => Promise<boolean>;
  returnFocusRef: RefObject<HTMLElement | null>;
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
  canLike,
  likePending,
  onToggleLike,
  canEdit,
  updatePending,
  onUpdate,
  returnFocusRef,
}: GalleryLightboxModalProps) {
  const { t } = useTranslation("gallery");
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const isOpen = open && item !== null;
  const zoomPercent = Math.round(zoom * 100);
  const titleIsValid = draftTitle.trim().length >= LIMITS.content.galleryTitle.min;

  useEffect(() => {
    setEditing(false);
    setDraftTitle(item?.title ?? "");
    setDraftDescription(item?.description ?? "");
  }, [item?.id, item?.revision_token, open]);

  const closeLightbox = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => { if (!nextOpen) closeLightbox(); }}>
      <DialogContent
        aria-label={t("modal.lightbox.title")}
        className="gallery-lb-content"
        overlayClassName="gallery-lb-overlay"
        showCloseButton={false}
        finalFocus={returnFocusRef}
        onKeyDown={(event) => {
          const target = event.target;
          if (
            editing
            || target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || (target instanceof HTMLElement && target.isContentEditable)
          ) return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onPrev();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onNext();
          }
        }}
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

            <div className="gallery-lb__stage">
              {total > 1 ? (
                <>
                  <button
                    type="button"
                    className="gallery-lb__nav gallery-lb__nav--prev"
                    onClick={onPrev}
                    aria-label={t("aria.prevItem")}
                    disabled={editing}
                  >
                    <ChevronLeftIcon size={28} />
                  </button>
                  <button
                    type="button"
                    className="gallery-lb__nav gallery-lb__nav--next"
                    onClick={onNext}
                    aria-label={t("aria.nextItem")}
                    disabled={editing}
                  >
                    <ChevronRightIcon size={28} />
                  </button>
                </>
              ) : null}

              {item.type === "image" ? (
                <div className="gallery-lb__zoom-controls">
                  <button
                    type="button"
                    aria-label={t("aria.zoomOut")}
                    disabled={zoom <= MIN_ZOOM}
                    onClick={() => setZoom((value) => Math.max(
                      MIN_ZOOM,
                      Number((value - ZOOM_STEP).toFixed(2)),
                    ))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label={t("aria.zoomReset")}
                    disabled={zoom === MIN_ZOOM}
                    onClick={() => setZoom(MIN_ZOOM)}
                  >
                    {zoomPercent}%
                  </button>
                  <button
                    type="button"
                    aria-label={t("aria.zoomIn")}
                    disabled={zoom >= MAX_ZOOM}
                    onClick={() => setZoom((value) => Math.min(
                      MAX_ZOOM,
                      Number((value + ZOOM_STEP).toFixed(2)),
                    ))}
                  >
                    +
                  </button>
                  <span className="sr-only" role="status" aria-live="polite">
                    {zoomPercent}%
                  </span>
                </div>
              ) : null}

              <div className="gallery-lb__media">
                {item.type === "image" ? (
                  <div
                    className="gallery-lb__img-wrap"
                    onWheel={(event) => {
                      event.preventDefault();
                      const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
                      setZoom((value) => Math.min(
                        MAX_ZOOM,
                        Math.max(MIN_ZOOM, Number((value + direction).toFixed(2))),
                      ));
                    }}
                    onDoubleClick={() => setZoom((value) => (value > MIN_ZOOM ? MIN_ZOOM : 2.2))}
                    style={{ cursor: zoom > MIN_ZOOM ? "zoom-out" : "zoom-in" }}
                  >
                    <RecoverableImage
                      source={resolveImageUrl(item.media_id, "full")}
                      alt={item.title || item.id}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      className="gallery-lb__img"
                      style={{ transform: `scale(${zoom})` }}
                      fallbackClassName="gallery-lb__image-fallback"
                      failureLabel={t("common:media.imageUnavailable")}
                      retryLabel={t("common:action.retry")}
                      announceFailure
                    />
                  </div>
                ) : (
                  <iframe
                    src={toEmbedVideoUrl(item.url)}
                    title={item.title || item.id}
                    className="gallery-lb__video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )}
              </div>
            </div>

            <aside className="gallery-lb__info">
              <div className="gallery-lb__summary">
                <div className="gallery-lb__summary-copy">
                  <span className="gallery-lb__type">{t(`type.${item.type}`)}</span>
                  <span className="gallery-lb__count">{Math.max(1, index + 1)} / {total}</span>
                </div>
                {canEdit && !editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setEditing(true)}
                  >
                    <PencilIcon size={14} aria-hidden="true" />
                    {t("action.editDetails")}
                  </Button>
                ) : null}
              </div>
              {editing ? (
                <form
                  className="gallery-lb__edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!titleIsValid || updatePending) return;
                    void onUpdate(item, {
                      title: draftTitle.trim(),
                      description: draftDescription.trim() || null,
                    }).then((updated) => {
                      if (updated) setEditing(false);
                    });
                  }}
                >
                  <label className="gallery-lb__edit-field">
                    <span>{t("field.title")}</span>
                    <Input
                      value={draftTitle}
                      maxLength={LIMITS.content.galleryTitle.max}
                      required
                      autoFocus
                      aria-label={t("field.title")}
                      disabled={updatePending}
                      aria-invalid={!titleIsValid}
                      onChange={(event) => setDraftTitle(event.currentTarget.value)}
                    />
                    <small aria-hidden="true">{draftTitle.length} / {LIMITS.content.galleryTitle.max}</small>
                  </label>
                  <label className="gallery-lb__edit-field">
                    <span className="gallery-lb__edit-label">
                      <span>{t("field.description")}</span>
                      <span>{t("field.optional")}</span>
                    </span>
                    <Textarea
                      value={draftDescription}
                      maxLength={LIMITS.content.galleryDescription.max}
                      rows={5}
                      aria-label={t("field.description")}
                      disabled={updatePending}
                      onChange={(event) => setDraftDescription(event.currentTarget.value)}
                    />
                    <small aria-hidden="true">{draftDescription.length} / {LIMITS.content.galleryDescription.max}</small>
                  </label>
                  <div className="gallery-lb__edit-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={updatePending}
                      onClick={() => {
                        setDraftTitle(item.title);
                        setDraftDescription(item.description ?? "");
                        setEditing(false);
                      }}
                    >
                      {t("common:action.cancel")}
                    </Button>
                    <Button type="submit" loading={updatePending} disabled={!titleIsValid}>
                      {t("common:action.save")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="gallery-lb__details">
                  <h2 className="gallery-lb__title">{item.title || item.id}</h2>
                  {item.description ? <p className="gallery-lb__description">{item.description}</p> : null}
                </div>
              )}
              <div className="gallery-lb__metadata">
                <span className="gallery-lb__uploader">{item.uploaded_by_name ?? item.uploaded_by}</span>
                <time className="gallery-lb__date" dateTime={item.created_at}>
                  {formatDateTime(item.created_at)}
                </time>
              </div>
              <div className="gallery-lb__footer">
                <GalleryLikeButton
                  liked={item.liked_by_viewer}
                  likeCount={item.like_count}
                  canLike={canLike}
                  loading={likePending}
                  className="gallery-like-button--lightbox"
                  onToggle={() => { void onToggleLike(item.id, item.liked_by_viewer); }}
                />
              </div>
            </aside>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
