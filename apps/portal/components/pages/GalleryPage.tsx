import { PhotoIcon } from "@portal/components/icons";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { Button, Group, Modal, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { modals } from "@mantine/modals";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue, useDisclosure, useIntersection } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  batchDeleteGalleryItems,
  createGalleryVideo,
  deleteGalleryItem,
  uploadGalleryImages,
  fetchGallery,
} from "../../services/GalleryService";
import { useAppError } from "../../hooks/useAppError";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { queryKeys } from "../../api/query-keys";
import { notifySuccess, notifyError } from "../../utils/notifications";
import { useAuthStore } from "../../stores/auth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { DEFAULT_IMAGE_WEBP_QUALITY, convertImageToWebP } from "@guild/shared/utils/media";
import { isAllowedGalleryVideoUrl, toEmbedVideoUrl } from "@guild/shared/utils/video";
import { GalleryFiltersCard } from "../feature/gallery/GalleryFiltersCard";
import { GalleryGrid } from "../feature/gallery/GalleryGrid";
import { GalleryLightboxModal } from "../feature/gallery/GalleryLightboxModal";
import { GalleryUploadQueueCard } from "../feature/gallery/GalleryUploadQueueCard";
import type { UploadStatus, UploadTask } from "../feature/gallery/shared";
import { PageLayout } from "../layout/PageLayout";
import { resolveGalleryMediaUrl } from "../../utils/media";
import "./GalleryPage.css";
const MAX_GALLERY_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

export function GalleryPage() {
  const { t } = useTranslation("gallery");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const canDeleteGallery = canManagePermission(["gallery.delete"]);
  const canUpload = canManagePermission(["gallery.upload"]) && !isExternalView;
  const canModerate = canDeleteGallery && !isExternalView;
  const { showError } = useAppError();

  const [typeFilter, setTypeFilter] = useState<"image" | "video" | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearchRaw] = useDebouncedValue(search, 300);
  const debouncedSearch = debouncedSearchRaw.trim().toLowerCase();
  const [videoUrl, setVideoUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [uploadQueue, setUploadQueue] = useState<UploadTask[]>([]);
  const [addMediaModalOpen, addMediaModalHandlers] = useDisclosure(false);
  const [addMediaTab, setAddMediaTab] = useState<"image" | "video">("image");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  const { ref: loadMoreRef, entry } = useIntersection({ rootMargin: "200px" });

  const galleryQuery = useInfiniteQuery({
    queryKey: queryKeys.gallery.list(
      sortOrder,
      typeFilter ?? "all",
      dateFrom || "none",
      dateTo || "none",
      debouncedSearch || "none",
    ),
    queryFn: ({ pageParam }) =>
      fetchGallery({
        cursor: pageParam ? String(pageParam) : undefined,
        limit: 20,
        type: typeFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
        order: sortOrder,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (entry?.isIntersecting && galleryQuery.hasNextPage && !galleryQuery.isFetchingNextPage) {
      void galleryQuery.fetchNextPage();
    }
  }, [entry?.isIntersecting, galleryQuery]);

  const createVideoMutation = useMutation({
    mutationFn: createGalleryVideo,
    onSuccess: async () => {
      notifySuccess(t("message.videoCreated"));
      setVideoUrl("");
      setVideoCaption("");
      addMediaModalHandlers.close();
      await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
    },
    onError: (error) => {
      showError(error, t("message.videoCreateFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGalleryItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
    },
    onError: (error) => {
      showError(error, t("message.deleteFailed"));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await batchDeleteGalleryItems(ids);
      return res.deleted;
    },
    onSuccess: async (count) => {
      notifySuccess(t("message.bulkDeleted", { count }));
      setSelectedIds([]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
    },
    onError: (error) => {
      showError(error, t("message.deleteFailed"));
    },
  });

  const rows = useMemo(() => {
    return (galleryQuery.data?.pages ?? []).flatMap((page) => page.data);
  }, [galleryQuery.data?.pages]);

  const lightboxItem = useMemo(() => rows.find((item) => item.id === lightboxId) ?? null, [lightboxId, rows]);
  const lightboxIndex = useMemo(() => rows.findIndex((item) => item.id === lightboxId), [lightboxId, rows]);

  const queuedCount = uploadQueue.filter((item) => item.status === "queued").length;
  const uploadingCount = uploadQueue.filter((item) => item.status === "uploading").length;
  const uploadImagesLabel = t("action.uploadImages");
  const clearDoneLabel = t("clearDone");
  const videoUrlPlaceholder = t("field.videoUrl");
  const captionPlaceholder = t("field.caption");
  const addVideoLabel = t("action.addVideo");

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectFiles = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const mapped: UploadTask[] = list
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        caption: "",
        status: file.size > MAX_GALLERY_IMAGE_SIZE_BYTES ? ("error" as UploadStatus) : ("queued" as UploadStatus),
        error:
          file.size > MAX_GALLERY_IMAGE_SIZE_BYTES
            ? t("message.fileTooLarge", { fileName: file.name })
            : undefined,
      }));
    setUploadQueue((current) => [...current, ...mapped]);
  };

  const openAddMediaModal = (tab: "image" | "video") => {
    setAddMediaTab(tab);
    addMediaModalHandlers.open();
  };

  const runUploadQueue = useCallback(async () => {
    if (queuedCount === 0) {
      return;
    }

    const pending = uploadQueue.filter((item) => item.status === "queued");
    let failedCount = 0;
    for (const task of pending) {
      setUploadQueue((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: "uploading",
                error: undefined,
              }
            : item,
        ),
      );
      try {
        const uploadFile = await convertImageToWebP(task.file, undefined, { quality: DEFAULT_IMAGE_WEBP_QUALITY });
        await uploadGalleryImages([uploadFile], [task.caption.trim() || undefined]);
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: "done",
                }
              : item,
          ),
        );
      } catch (error) {
        failedCount++;
        const fallback = t("message.uploadFailed");
        const errorText = error instanceof Error ? error.message : fallback;
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: "error",
                  error: t("message.uploadTaskFailed", { error: errorText || fallback }),
                }
              : item,
          ),
        );
      }
    }

    await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
    if (failedCount === 0) {
      notifySuccess(t("message.uploaded"));
    }
  }, [queuedCount, queryClient, t, uploadQueue]);

  const clearFinishedUploads = useCallback(() => {
    setUploadQueue((current) => current.filter((item) => item.status !== "done"));
  }, []);

  const openLightboxAt = (index: number) => {
    if (index < 0 || index >= rows.length) {
      return;
    }
    const target = rows[index];
    if (!target) {
      return;
    }
    setLightboxId(target.id);
  };

  const openLightboxPrev = useCallback(() => {
    if (rows.length === 0) return;
    if (lightboxIndex <= 0) {
      openLightboxAt(rows.length - 1);
      return;
    }
    openLightboxAt(lightboxIndex - 1);
  }, [rows, lightboxIndex]);

  const openLightboxNext = useCallback(() => {
    if (rows.length === 0) return;
    if (lightboxIndex < 0 || lightboxIndex >= rows.length - 1) {
      openLightboxAt(0);
      return;
    }
    openLightboxAt(lightboxIndex + 1);
  }, [rows, lightboxIndex]);

  useEffect(() => {
    if (!lightboxItem) {
      return;
    }
    setLightboxZoom(1);
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        openLightboxPrev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        openLightboxNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxItem, lightboxIndex, rows.length, openLightboxPrev, openLightboxNext]);

  useLoadWarningToast(galleryQuery.isError, t("common:loadErrorRetry"));
  const emptyTitle = typeFilter || dateFrom || dateTo ? t("empty.filtered") : t("empty.default");
  const emptyDescription = canUpload
    ? t("empty.hintUpload")
    : !user
      ? t("empty.guest")
      : undefined;

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<PhotoIcon size={22} />} className="gallery-page">
      <Modal
        opened={addMediaModalOpen}
        onClose={addMediaModalHandlers.close}
        title={t("modal.addMedia.title")}
        size="lg"
      >
        <Tabs value={addMediaTab} onChange={(value) => setAddMediaTab((value as "image" | "video") ?? "image")}>
          <Tabs.List>
            <Tabs.Tab value="image">{t("modal.addMedia.tabImage")}</Tabs.Tab>
            <Tabs.Tab value="video">{t("modal.addMedia.tabVideo")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="image" pt="sm">
            <Stack gap={10}>
              <Dropzone
                onDrop={(files) => selectFiles(files)}
                accept={IMAGE_MIME_TYPE}
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
                  <DepthButton
                    type="primary"
                    onClick={() => {
                      void runUploadQueue();
                    }}
                    loading={uploadingCount > 0}
                    disabled={queuedCount === 0}
                  >
                    {uploadImagesLabel}
                  </DepthButton>
                  <Button onClick={clearFinishedUploads} disabled={uploadQueue.every((item) => item.status !== "done")}>
                    {clearDoneLabel}
                  </Button>
                </Group>
                <Text size="sm" c="dimmed">
                  {t("upload.summary", { queued: queuedCount, uploading: uploadingCount, total: uploadQueue.length })}
                </Text>
              </Group>
              <GalleryUploadQueueCard
                uploadQueue={uploadQueue}
                uploadingCount={uploadingCount}
                uploadQueueTitle={t("uploadQueue")}
                captionPlaceholder={t("field.caption")}
                onCaptionChange={(taskId, caption) =>
                  setUploadQueue((current) =>
                    current.map((item) =>
                      item.id === taskId ? { ...item, caption } : item,
                    ),
                  )
                }
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="video" pt="sm">
            <Stack gap={10}>
              <TextInput
                className="gallery-video-url-input"
                placeholder={videoUrlPlaceholder}
                value={videoUrl}
                aria-label={t("field.videoUrlAria")}
                onChange={(event) => setVideoUrl(event.currentTarget.value)}
              />
              <TextInput
                className="gallery-video-caption-input"
                placeholder={captionPlaceholder}
                value={videoCaption}
                aria-label={t("field.captionAria")}
                onChange={(event) => setVideoCaption(event.currentTarget.value)}
              />
              <Group justify="flex-end">
                <DepthButton
                  onClick={() => {
                    if (!isAllowedGalleryVideoUrl(videoUrl.trim())) {
                      notifyError(t("message.videoHostUnsupported"));
                      return;
                    }
                    createVideoMutation.mutate({
                      type: "video",
                      url: videoUrl,
                      caption: videoCaption || undefined,
                    });
                  }}
                  loading={createVideoMutation.isPending}
                  disabled={!videoUrl.trim()}
                >
                  {addVideoLabel}
                </DepthButton>
              </Group>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Modal>

      <GalleryFiltersCard
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        dateFrom={dateFrom}
        dateTo={dateTo}
        search={search}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onSearchChange={setSearch}
        onClearDates={() => {
          setDateFrom("");
          setDateTo("");
        }}
        canModerate={canModerate}
        canUpload={canUpload}
        selectedCount={selectedIds.length}
        onBulkDelete={() => bulkDeleteMutation.mutate(selectedIds)}
        bulkDeletePending={bulkDeleteMutation.isPending}
        onAddMedia={() => openAddMediaModal("image")}
        filterTypeLabel={t("filter.type")}
        bulkDeleteLabel={t("action.bulkDelete")}
        addMediaLabel={t("action.addMedia")}
      />

      <GalleryGrid
        rows={rows}
        isLoading={galleryQuery.isLoading}
        isError={galleryQuery.isError}
        isExternalView={isExternalView}
        canModerate={canModerate}
        selectedIds={selectedIds}
        deletePending={deleteMutation.isPending}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        errorTitle={t("empty.error")}
        disableResetFilters={!typeFilter && !dateFrom && !dateTo}
        resetFiltersLabel={t("action.resetFilters")}
        onResetFilters={() => {
          setTypeFilter(undefined);
          setDateFrom("");
          setDateTo("");
        }}
        onToggleSelect={toggleSelect}
        onDelete={(id) =>
          modals.openConfirmModal({
            title: t("confirm.delete.title"),
            children: <Text size="sm">{t("confirm.delete.description")}</Text>,
            labels: { confirm: t("action.delete"), cancel: t("common:action.cancel") },
            confirmProps: { color: "red" },
            onConfirm: () => deleteMutation.mutate(id),
          })
        }
        onOpenLightbox={setLightboxId}
        resolveImageUrl={resolveGalleryMediaUrl}
        formatDateTime={formatDateTime}
        actionDeleteLabel={t("action.delete")}
      />

      <div ref={loadMoreRef} style={{ height: 1 }} />
      {galleryQuery.hasNextPage ? (
        <Button
          fullWidth
          onClick={() => {
            void galleryQuery.fetchNextPage();
          }}
          loading={galleryQuery.isFetchingNextPage}
        >
          {t("loadMore")}
        </Button>
      ) : null}

      <GalleryLightboxModal
        open={Boolean(lightboxItem)}
        item={lightboxItem}
        index={lightboxIndex}
        total={rows.length}
        zoom={lightboxZoom}
        onClose={() => setLightboxId(null)}
        onPrev={openLightboxPrev}
        onNext={openLightboxNext}
        setZoom={setLightboxZoom}
        resolveImageUrl={resolveGalleryMediaUrl}
        toEmbedVideoUrl={toEmbedVideoUrl}
        formatDateTime={formatDateTime}
        isExternalView={isExternalView}
      />
    </PageLayout>
  );
}

