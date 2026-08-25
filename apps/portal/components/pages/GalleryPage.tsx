import { IMAGE_FILE_ACCEPT } from "@guild/shared";
import { PhotoIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@portal/components/ui/tabs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGalleryPageController } from "../../hooks/useGalleryPageController";
import { GalleryFiltersCard } from "../feature/gallery/GalleryFiltersCard";
import { GalleryGrid } from "../feature/gallery/GalleryGrid";
import { GalleryLightboxModal } from "../feature/gallery/GalleryLightboxModal";
import { GalleryUploadQueueCard } from "../feature/gallery/GalleryUploadQueueCard";
import { PageLayout } from "../layout/PageLayout";
import "./GalleryPage.css";

export function GalleryPage() {
  const { t } = useTranslation("gallery");
  const c = useGalleryPageController();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !c.galleryQuery.hasNextPage || c.galleryQuery.isFetchingNextPage) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void c.galleryQuery.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [c.galleryQuery.fetchNextPage, c.galleryQuery.hasNextPage, c.galleryQuery.isFetchingNextPage]);

  const uploadImagesLabel = t("action.uploadImages");
  const clearDoneLabel = t("clearDone");
  const videoUrlPlaceholder = t("field.videoUrl");
  const captionPlaceholder = t("field.caption");
  const addVideoLabel = t("action.addVideo");
  const filters = (
    <GalleryFiltersCard
      typeFilter={c.typeFilter}
      onTypeFilterChange={c.setTypeFilter}
      sortOrder={c.sortOrder}
      onSortOrderChange={c.setSortOrder}
      dateFrom={c.dateFrom}
      dateTo={c.dateTo}
      search={c.search}
      onDateFromChange={c.setDateFrom}
      onDateToChange={c.setDateTo}
      onSearchChange={c.setSearch}
      onClearDates={() => {
        c.setDateFrom("");
        c.setDateTo("");
      }}
      canModerate={c.canModerate}
      canUpload={c.canUpload}
      selectedCount={c.selectedIds.length}
      onBulkDelete={() => c.bulkDeleteMutation.mutate(c.selectedIds)}
      bulkDeletePending={c.bulkDeleteMutation.isPending}
      onAddMedia={() => c.openAddMediaModal("image")}
      filterTypeLabel={t("filter.type")}
      bulkDeleteLabel={t("action.bulkDelete")}
      addMediaLabel={t("action.addMedia")}
    />
  );

  return (
    <PageLayout className="gallery-page" toolbar={filters}>
      <Dialog
        open={c.addMediaModalOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) c.closeAddMediaModal(); }}
      >
        <DialogContent className="gallery-add-media-dialog" showCloseButton={false}>
          <DialogHeader className="gallery-add-media-dialog__header">
            <DialogTitle>{t("modal.addMedia.title")}</DialogTitle>
            <DialogClose
              render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:action.close")} />}
            >
              <XIcon size={16} aria-hidden="true" />
            </DialogClose>
          </DialogHeader>
          <Tabs value={c.addMediaTab} onValueChange={(value) => c.setAddMediaTab(value as "image" | "video")}>
            <TabsList>
              <TabsTrigger value="image">{t("modal.addMedia.tabImage")}</TabsTrigger>
              <TabsTrigger value="video">{t("modal.addMedia.tabVideo")}</TabsTrigger>
            </TabsList>

            <TabsContent value="image" className="gallery-add-media-tab">
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
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <PhotoIcon size={40} aria-hidden="true" />
                    <span>{t("dropzone")}</span>
                  </button>
                </div>
                <div className="gallery-upload-controls">
                  <div className="gallery-upload-controls__actions">
                    <Button
                      onClick={() => { void c.runUploadQueue(); }}
                      loading={c.uploadingCount > 0}
                      disabled={c.queuedCount === 0}
                    >
                      {uploadImagesLabel}
                    </Button>
                    {c.uploadingCount > 0 ? (
                      <Button variant="outline" onClick={c.cancelUploadQueue}>
                        {t("action.cancelUpload")}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={c.clearFinishedUploads}
                      disabled={c.uploadQueue.every((item) => item.status !== "done")}
                    >
                      {clearDoneLabel}
                    </Button>
                  </div>
                  <p className="gallery-upload-controls__summary">
                    {t("upload.summary", {
                      queued: c.queuedCount,
                      uploading: c.uploadingCount,
                      total: c.uploadQueue.length,
                    })}
                  </p>
                </div>
                <GalleryUploadQueueCard
                  uploadQueue={c.uploadQueue}
                  uploadingCount={c.uploadingCount}
                  uploadQueueTitle={t("uploadQueue")}
                  captionPlaceholder={t("field.caption")}
                  retryLabel={t("common:action.retry")}
                  removeLabel={t("action.removeUpload")}
                  canRetryUpload={c.canRetryUpload}
                  onCaptionChange={c.handleCaptionChange}
                  onRetry={c.retryUpload}
                  onRemove={c.removeUpload}
                />
              </div>
            </TabsContent>

            <TabsContent value="video" className="gallery-add-media-tab">
              <div className="gallery-add-media-stack">
                <Input
                  className="gallery-video-url-input"
                  placeholder={videoUrlPlaceholder}
                  value={c.videoUrl}
                  aria-label={t("field.videoUrlAria")}
                  onChange={(event) => c.setVideoUrl(event.currentTarget.value)}
                />
                <Input
                  className="gallery-video-caption-input"
                  placeholder={captionPlaceholder}
                  value={c.videoCaption}
                  aria-label={t("field.captionAria")}
                  onChange={(event) => c.setVideoCaption(event.currentTarget.value)}
                />
                <div className="gallery-video-actions">
                  <Button
                    onClick={c.handleAddVideo}
                    loading={c.createVideoMutation.isPending}
                    disabled={!c.videoUrl.trim()}
                  >
                    {addVideoLabel}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <div className="gallery-page__workspace">
        <GalleryGrid
          rows={c.rows}
          isLoading={c.galleryQuery.isLoading}
          isError={c.galleryQuery.isError}
          isExternalView={c.isExternalView}
          canModerate={c.canModerate}
          selectedIds={c.selectedIds}
          emptyTitle={c.emptyTitle}
          emptyDescription={c.emptyDescription}
          errorTitle={t("empty.error")}
          errorDescription={t("empty.errorDescription")}
          retryLabel={t("common:action.retry")}
          retryPending={c.galleryQuery.isFetching}
          hasActiveFilters={c.hasActiveFilters}
          canUpload={c.canUpload}
          resetFiltersLabel={t("action.resetFilters")}
          addMediaLabel={t("action.addMedia")}
          onRetry={() => { void c.galleryQuery.refetch(); }}
          onResetFilters={() => {
            c.setTypeFilter(undefined);
            c.setDateFrom("");
            c.setDateTo("");
            c.setSearch("");
          }}
          onAddMedia={() => c.openAddMediaModal("image")}
          onToggleSelect={c.toggleSelect}
          onDelete={c.handleDeleteItem}
          onOpenLightbox={c.setLightboxId}
          resolveImageUrl={c.resolveImageUrl}
          formatDateTime={c.formatDateTime}
          actionDeleteLabel={t("action.delete")}
        />

        <div ref={loadMoreRef} className="gallery-load-more-sentinel" />
        {c.galleryQuery.hasNextPage ? (
          <div className="gallery-load-more">
            <Button
              variant="outline"
              onClick={() => { void c.galleryQuery.fetchNextPage(); }}
              loading={c.galleryQuery.isFetchingNextPage}
            >
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      <GalleryLightboxModal
        open={Boolean(c.lightboxItem)}
        item={c.lightboxItem}
        index={c.lightboxIndex}
        total={c.rows.length}
        zoom={c.lightboxZoom}
        onClose={() => c.setLightboxId(null)}
        onPrev={c.openLightboxPrev}
        onNext={c.openLightboxNext}
        setZoom={c.setLightboxZoom}
        resolveImageUrl={c.resolveImageUrl}
        toEmbedVideoUrl={c.toEmbedVideoUrl}
        formatDateTime={c.formatDateTime}
        isExternalView={c.isExternalView}
      />
    </PageLayout>
  );
}
