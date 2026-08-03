import { PhotoIcon } from "@portal/components/icons";
import { Button, Group, Modal, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { SELECTABLE_IMAGE_TYPES } from "@guild/shared";
import { useIntersection } from "@mantine/hooks";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGalleryPageController } from "../../hooks/useGalleryPageController";
import { GalleryFiltersCard } from "../feature/gallery/GalleryFiltersCard";
import { GalleryGrid } from "../feature/gallery/GalleryGrid";
import { GalleryLightboxModal } from "../feature/gallery/GalleryLightboxModal";
import { GalleryUploadQueueCard } from "../feature/gallery/GalleryUploadQueueCard";
import { PageLayout } from "../layout/PageLayout";
import "./GalleryPage.css";

const MAX_GALLERY_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export function GalleryPage() {
  const { t } = useTranslation("gallery");
  const c = useGalleryPageController();

  const { ref: loadMoreRef, entry } = useIntersection({ rootMargin: "200px" });

  useEffect(() => {
    if (entry?.isIntersecting && c.galleryQuery.hasNextPage && !c.galleryQuery.isFetchingNextPage) {
      void c.galleryQuery.fetchNextPage();
    }
  }, [entry?.isIntersecting, c.galleryQuery]);

  const uploadImagesLabel = t("action.uploadImages");
  const clearDoneLabel = t("clearDone");
  const videoUrlPlaceholder = t("field.videoUrl");
  const captionPlaceholder = t("field.caption");
  const addVideoLabel = t("action.addVideo");

  return (
    <PageLayout className="gallery-page">
      <Modal
        opened={c.addMediaModalOpen}
        onClose={c.addMediaModalHandlers.close}
        title={t("modal.addMedia.title")}
        size="lg"
      >
        <Tabs value={c.addMediaTab} onChange={(value) => c.setAddMediaTab((value as "image" | "video") ?? "image")}>
          <Tabs.List>
            <Tabs.Tab value="image">{t("modal.addMedia.tabImage")}</Tabs.Tab>
            <Tabs.Tab value="video">{t("modal.addMedia.tabVideo")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="image" pt="sm">
            <Stack gap={10}>
              <Dropzone
                onDrop={(files) => c.selectFiles(files)}
                onReject={(rejections) => c.selectFiles(rejections.map(({ file }) => file))}
                accept={[...SELECTABLE_IMAGE_TYPES]}
                maxSize={MAX_GALLERY_IMAGE_SIZE_BYTES}
                className="gallery-dropzone gallery-dropzone--modal"
              >
                <Group justify="center" gap="xl" style={{ pointerEvents: "none" }}>
                  <PhotoIcon size={40} />
                  <Text>{t("dropzone")}</Text>
                </Group>
              </Dropzone>
              <Group gap={8} wrap="wrap" justify="space-between">
                <Group gap={8} wrap="wrap">
                  <Button
                    onClick={() => {
                      void c.runUploadQueue();
                    }}
                    loading={c.uploadingCount > 0}
                    disabled={c.queuedCount === 0}
                  >
                    {uploadImagesLabel}
                  </Button>
                  {c.uploadingCount > 0 ? (
                    <Button variant="light" onClick={c.cancelUploadQueue}>
                      {t("action.cancelUpload")}
                    </Button>
                  ) : null}
                  <Button
                    onClick={c.clearFinishedUploads}
                    disabled={c.uploadQueue.every((item) => item.status !== "done")}
                  >
                    {clearDoneLabel}
                  </Button>
                </Group>
                <Text size="sm" c="dimmed">
                  {t("upload.summary", {
                    queued: c.queuedCount,
                    uploading: c.uploadingCount,
                    total: c.uploadQueue.length,
                  })}
                </Text>
              </Group>
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
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="video" pt="sm">
            <Stack gap={10}>
              <TextInput
                className="gallery-video-url-input"
                placeholder={videoUrlPlaceholder}
                value={c.videoUrl}
                aria-label={t("field.videoUrlAria")}
                onChange={(event) => c.setVideoUrl(event.currentTarget.value)}
              />
              <TextInput
                className="gallery-video-caption-input"
                placeholder={captionPlaceholder}
                value={c.videoCaption}
                aria-label={t("field.captionAria")}
                onChange={(event) => c.setVideoCaption(event.currentTarget.value)}
              />
              <Group justify="flex-end">
                <Button
                  onClick={c.handleAddVideo}
                  loading={c.createVideoMutation.isPending}
                  disabled={!c.videoUrl.trim()}
                >
                  {addVideoLabel}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Modal>

      <Stack gap={16}>
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
        onRetry={() => {
          void c.galleryQuery.refetch();
        }}
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

      <div ref={loadMoreRef} style={{ height: 1 }} />
      {c.galleryQuery.hasNextPage ? (
        <Group justify="center">
          <Button
            variant="default"
            onClick={() => {
              void c.galleryQuery.fetchNextPage();
            }}
            loading={c.galleryQuery.isFetchingNextPage}
          >
            {t("loadMore")}
          </Button>
        </Group>
      ) : null}
      </Stack>

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
