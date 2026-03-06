import { hasRoleAtLeast } from "@guild/shared";
import { IconPhoto } from "@tabler/icons-react";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { Button, Group, Modal, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createGalleryVideo,
  deleteGalleryItem,
  uploadGalleryImages,
} from "../../api/mutations/gallery";
import { queryKeys } from "../../api/query-keys";
import { fetchGallery } from "../../api/queries/gallery";
import { useAppError } from "../../hooks/useAppError";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useAuthStore } from "../../stores/auth";
import { DEFAULT_IMAGE_WEBP_QUALITY, convertImageToWebP } from "../../utils/media-conversion";
import { toEmbedVideoUrl } from "../../utils/video-embed";
import { GalleryFiltersCard } from "../feature/gallery/GalleryFiltersCard";
import { GalleryGrid } from "../feature/gallery/GalleryGrid";
import { GalleryLightboxModal } from "../feature/gallery/GalleryLightboxModal";
import { GalleryUploadQueueCard } from "../feature/gallery/GalleryUploadQueueCard";
import type { UploadStatus, UploadTask } from "../feature/gallery/shared";
import { PageLayout } from "../layout/PageLayout";
import "./GalleryPage.css";
const MAX_GALLERY_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function GalleryPage() {
  const { t } = useTranslation("gallery");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const canUpload = Boolean(user) && !isExternalView;
  const canModerate = isModerator && !isExternalView;
  const { showError } = useAppError();

  const [typeFilter, setTypeFilter] = useState<"image" | "video" | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [uploadQueue, setUploadQueue] = useState<UploadTask[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [addMediaModalOpen, setAddMediaModalOpen] = useState(false);
  const [addMediaTab, setAddMediaTab] = useState<"image" | "video">("image");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const galleryQuery = useInfiniteQuery({
    queryKey: queryKeys.gallery.list(
      sortOrder,
      typeFilter ?? "all",
      dateFrom || "none",
      dateTo || "none",
      search.trim().toLowerCase() || "none",
    ),
    queryFn: ({ pageParam }) =>
      fetchGallery({
        cursor: pageParam ? String(pageParam) : undefined,
        limit: 20,
        type: typeFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: search.trim() || undefined,
        order: sortOrder,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (!galleryQuery.hasNextPage || galleryQuery.isFetchingNextPage) return;
        void galleryQuery.fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [galleryQuery]);

  const createVideoMutation = useMutation({
    mutationFn: createGalleryVideo,
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.videoCreated") });
      setVideoUrl("");
      setVideoCaption("");
      setAddMediaModalOpen(false);
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
      for (const id of ids) {
        await deleteGalleryItem(id);
      }
      return ids.length;
    },
    onSuccess: async (count) => {
      notifications.show({ color: "infini-success", message: t("message.bulkDeleted", { count }) });
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
    setAddMediaModalOpen(true);
  };

  const handleDropzoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDropzoneDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDropzoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    selectFiles(event.dataTransfer.files);
  };

  const runUploadQueue = useCallback(async () => {
    if (queuedCount === 0) {
      return;
    }

    const pending = uploadQueue.filter((item) => item.status === "queued");
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
    notifications.show({ color: "infini-success", message: t("message.uploaded") });
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

  const openLightboxPrev = () => {
    if (rows.length === 0) return;
    if (lightboxIndex <= 0) {
      openLightboxAt(rows.length - 1);
      return;
    }
    openLightboxAt(lightboxIndex - 1);
  };

  const openLightboxNext = () => {
    if (rows.length === 0) return;
    if (lightboxIndex < 0 || lightboxIndex >= rows.length - 1) {
      openLightboxAt(0);
      return;
    }
    openLightboxAt(lightboxIndex + 1);
  };

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
  }, [lightboxItem, lightboxIndex, rows.length]);

  useLoadWarningToast(galleryQuery.isError, t("common:loadErrorRetry"));
  const emptyTitle = typeFilter || dateFrom || dateTo ? t("empty.filtered") : t("empty.default");
  const emptyDescription = canUpload ? t("empty.hintUpload") : undefined;

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<IconPhoto size={22} />} className="gallery-page">
      <Modal
        opened={addMediaModalOpen}
        onClose={() => setAddMediaModalOpen(false)}
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
              <div
                className={`gallery-dropzone gallery-dropzone--modal${isDragOver ? " gallery-dropzone--active" : ""}`}
                onDragOver={handleDropzoneDragOver}
                onDragLeave={handleDropzoneDragLeave}
                onDrop={handleDropzoneDrop}
              >
                <Text>{t("dropzone")}</Text>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(event) => selectFiles(event.target.files)}
                  aria-label="Select gallery images"
                />
              </div>
              <Group gap={8} wrap="wrap" justify="space-between">
                <Group gap={8} wrap="wrap">
                  <MotionButton
                    type="primary"
                    onClick={() => {
                      void runUploadQueue();
                    }}
                    loading={uploadingCount > 0}
                    disabled={queuedCount === 0}
                  >
                    {uploadImagesLabel}
                  </MotionButton>
                  <Button onClick={clearFinishedUploads} disabled={uploadQueue.every((item) => item.status !== "done")}>
                    {clearDoneLabel}
                  </Button>
                </Group>
                <Text size="sm" c="dimmed">
                  {t("upload.summary", { queued: queuedCount, uploading: uploadingCount, total: uploadQueue.length })}
                </Text>
              </Group>
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
                <MotionButton
                  onClick={() =>
                    createVideoMutation.mutate({
                      type: "video",
                      url: videoUrl,
                      caption: videoCaption || undefined,
                    })
                  }
                  loading={createVideoMutation.isPending}
                  disabled={!videoUrl.trim()}
                >
                  {addVideoLabel}
                </MotionButton>
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

      <GalleryUploadQueueCard
        uploadQueue={uploadQueue}
        uploadingCount={uploadingCount}
        uploadQueueTitle={t("uploadQueue")}
        captionPlaceholder={t("field.caption")}
        onCaptionChange={(taskId, caption) =>
          setUploadQueue((current) =>
            current.map((item) =>
              item.id === taskId
                ? {
                    ...item,
                    caption,
                  }
                : item,
            ),
          )
        }
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
        onDelete={(id) => deleteMutation.mutate(id)}
        onOpenLightbox={setLightboxId}
        isHttpUrl={isHttpUrl}
        toEmbedVideoUrl={toEmbedVideoUrl}
        formatDateTime={formatDateTime}
        actionDeleteLabel={t("action.delete")}
        fieldR2ObjectLabel={t("field.r2Object")}
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
        isHttpUrl={isHttpUrl}
        toEmbedVideoUrl={toEmbedVideoUrl}
        fieldR2ObjectLabel={t("field.r2Object")}
      />
    </PageLayout>
  );
}

