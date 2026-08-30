import { IMAGE_FILE_ACCEPT } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { PhotoIcon, UploadIcon, VideoIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Textarea } from "@portal/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@portal/components/ui/tabs";
import type { useGalleryPageController } from "@portal/hooks/useGalleryPageController";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GalleryUploadQueueCard } from "./GalleryUploadQueueCard";

type GalleryAddMediaDialogProps = {
  controller: ReturnType<typeof useGalleryPageController>;
};

export function GalleryAddMediaDialog({ controller: c }: GalleryAddMediaDialogProps) {
  const { t } = useTranslation("gallery");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const completedCount = c.uploadQueue.filter((item) => item.status === "done").length;
  const queuedTitlesAreValid = c.uploadQueue
    .filter((item) => item.status === "queued")
    .every((item) => item.title.trim().length >= LIMITS.content.galleryTitle.min);
  const canUploadImages = c.queuedCount > 0 && queuedTitlesAreValid && c.uploadingCount === 0;
  const canAddVideo = Boolean(c.videoUrl.trim() && c.videoTitle.trim())
    && !c.createVideoMutation.isPending;
  const maxQueueItems = Math.min(c.galleryImageQuota, 50);

  return (
    <Dialog
      open={c.addMediaModalOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && c.uploadingCount === 0) c.closeAddMediaModal();
      }}
    >
      <DialogContent className="gallery-add-media-dialog" showCloseButton={false}>
        <DialogHeader className="gallery-add-media-dialog__header">
          <div className="gallery-add-media-dialog__heading">
            <span className="gallery-add-media-dialog__icon" aria-hidden="true">
              {c.addMediaTab === "image" ? <PhotoIcon size={22} /> : <VideoIcon size={22} />}
            </span>
            <div>
              <DialogTitle>{t("modal.addMedia.title")}</DialogTitle>
              <DialogDescription>{t("modal.addMedia.description")}</DialogDescription>
            </div>
          </div>
          <DialogClose
            render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={c.uploadingCount > 0}
                aria-label={t("common:action.close")}
              />
            )}
          >
            <XIcon size={16} aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        <Tabs
          className="gallery-add-media-dialog__tabs"
          value={c.addMediaTab}
          onValueChange={(value) => c.setAddMediaTab(value as "image" | "video")}
        >
          <TabsList className="gallery-add-media-dialog__tab-list" variant="line">
            <TabsTrigger value="image">
              <PhotoIcon size={16} aria-hidden="true" />
              {t("modal.addMedia.tabImage")}
            </TabsTrigger>
            <TabsTrigger value="video">
              <VideoIcon size={16} aria-hidden="true" />
              {t("modal.addMedia.tabVideo")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="image" className="gallery-add-media-dialog__body">
            <div className="gallery-add-media-stack">
              <div
                className={`gallery-dropzone gallery-dropzone--modal${isDraggingFiles ? " gallery-dropzone--dragging" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDraggingFiles(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setIsDraggingFiles(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingFiles(false);
                  c.selectFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMAGE_FILE_ACCEPT}
                  multiple
                  className="gallery-dropzone__input"
                  onChange={(event) => {
                    c.selectFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  className="gallery-dropzone__select"
                  disabled={c.uploadingCount > 0 || c.uploadQueue.length >= maxQueueItems}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="gallery-dropzone__mark" aria-hidden="true">
                    <PhotoIcon size={30} />
                  </span>
                  <span className="gallery-dropzone__copy">
                    <strong>{t("dropzone")}</strong>
                    <small>{t("upload.selectHint", { max: maxQueueItems })}</small>
                  </span>
                </button>
              </div>

              <GalleryUploadQueueCard
                uploadQueue={c.uploadQueue}
                uploadingCount={c.uploadingCount}
                uploadQueueTitle={t("uploadQueue")}
                titlePlaceholder={t("field.title")}
                descriptionPlaceholder={t("field.description")}
                retryLabel={t("common:action.retry")}
                removeLabel={t("action.removeUpload")}
                canRetryUpload={c.canRetryUpload}
                onTitleChange={c.handleTitleChange}
                onDescriptionChange={c.handleDescriptionChange}
                onRetry={c.retryUpload}
                onRemove={c.removeUpload}
              />
            </div>
          </TabsContent>

          <TabsContent value="video" className="gallery-add-media-dialog__body">
            <form
              id="gallery-add-video-form"
              className="gallery-video-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (canAddVideo) c.handleAddVideo();
              }}
            >
              <div className="gallery-video-form__intro">
                <VideoIcon size={22} aria-hidden="true" />
                <div>
                  <strong>{t("videoForm.title")}</strong>
                  <p>{t("videoForm.description")}</p>
                </div>
              </div>
              <label className="gallery-video-form__field" htmlFor="gallery-video-url">
                <span className="gallery-video-form__label">
                  <span>{t("field.videoUrl")}</span>
                  <span>{t("field.required")}</span>
                </span>
                <Input
                  id="gallery-video-url"
                  className="gallery-video-url-input"
                  type="url"
                  placeholder="https://"
                  value={c.videoUrl}
                  maxLength={2_000}
                  required
                  aria-label={t("field.videoUrlAria")}
                  disabled={c.createVideoMutation.isPending}
                  onChange={(event) => c.setVideoUrl(event.currentTarget.value)}
                />
                <small>{t("videoForm.hostHint")}</small>
              </label>
              <label className="gallery-video-form__field" htmlFor="gallery-video-title">
                <span className="gallery-video-form__label">
                  <span>{t("field.title")}</span>
                  <span>{t("field.required")}</span>
                </span>
                <Input
                  id="gallery-video-title"
                  className="gallery-video-title-input"
                  value={c.videoTitle}
                  maxLength={LIMITS.content.galleryTitle.max}
                  required
                  aria-label={t("field.videoTitleAria")}
                  disabled={c.createVideoMutation.isPending}
                  onChange={(event) => c.setVideoTitle(event.currentTarget.value)}
                />
                <small>{c.videoTitle.length} / {LIMITS.content.galleryTitle.max}</small>
              </label>
              <label className="gallery-video-form__field" htmlFor="gallery-video-description">
                <span className="gallery-video-form__label">
                  <span>{t("field.description")}</span>
                  <span>{t("field.optional")}</span>
                </span>
                <Textarea
                  id="gallery-video-description"
                  className="gallery-video-description-input"
                  value={c.videoDescription}
                  maxLength={LIMITS.content.galleryDescription.max}
                  aria-label={t("field.videoDescriptionAria")}
                  disabled={c.createVideoMutation.isPending}
                  onChange={(event) => c.setVideoDescription(event.currentTarget.value)}
                  rows={5}
                />
                <small>{c.videoDescription.length} / {LIMITS.content.galleryDescription.max}</small>
              </label>
            </form>
          </TabsContent>

          <footer className="gallery-add-media-dialog__footer">
            {c.addMediaTab === "image" ? (
              <>
                <p className="gallery-upload-controls__summary" role="status" aria-live="polite">
                  {t("upload.summary", {
                    queued: c.queuedCount,
                    uploading: c.uploadingCount,
                    total: c.uploadQueue.length,
                  })}
                </p>
                <div className="gallery-upload-controls__actions">
                  {completedCount > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={c.uploadingCount > 0}
                      onClick={c.clearFinishedUploads}
                    >
                      {t("clearDone")}
                    </Button>
                  ) : null}
                  {c.uploadingCount > 0 ? (
                    <Button type="button" variant="outline" onClick={c.cancelUploadQueue}>
                      {t("action.cancelUpload")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    loading={c.uploadingCount > 0}
                    disabled={!canUploadImages}
                    onClick={() => { void c.runUploadQueue(); }}
                  >
                    <UploadIcon size={16} aria-hidden="true" />
                    {t("action.uploadCount", { count: c.queuedCount })}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="gallery-upload-controls__summary">{t("videoForm.footerHint")}</p>
                <div className="gallery-upload-controls__actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={c.createVideoMutation.isPending}
                    onClick={c.closeAddMediaModal}
                  >
                    {t("common:action.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    form="gallery-add-video-form"
                    loading={c.createVideoMutation.isPending}
                    disabled={!canAddVideo}
                  >
                    <VideoIcon size={16} aria-hidden="true" />
                    {t("action.addVideo")}
                  </Button>
                </div>
              </>
            )}
          </footer>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
