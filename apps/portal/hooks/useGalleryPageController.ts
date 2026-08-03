import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useTranslation } from "react-i18next";
import {
  batchDeleteGalleryItems,
  createGalleryVideo,
  deleteGalleryItem,
  uploadGalleryImages,
  fetchGallery,
} from "../services/GalleryService";
import { useAppError } from "./useAppError";
import { useExternalView } from "./useExternalView";
import { useLoadWarningToast } from "./useLoadWarningToast";
import { queryKeys } from "../api/query-keys";
import { notifySuccess, notifyError } from "../utils/notifications";
import { useAuthStore } from "../stores/auth";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { isAllowedGalleryVideoUrl, toEmbedVideoUrl } from "@guild/shared/utils/video";
import type { UploadTask } from "../types/media";
import { resolveGalleryMediaUrl } from "../utils/media";

const MAX_GALLERY_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export type GalleryUploadFileClassification = "queued" | "unsupported" | "too-large";

export function classifyGalleryUploadFile(
  file: Pick<File, "type" | "size">,
): GalleryUploadFileClassification {
  if (!file.type.startsWith("image/")) {
    return "unsupported";
  }
  if (file.size > MAX_GALLERY_IMAGE_SIZE_BYTES) {
    return "too-large";
  }
  return "queued";
}

export function getVisibleGallerySelection(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visible = new Set(visibleIds);
  return selectedIds.filter((id) => visible.has(id));
}

export function canRetryGalleryUpload(task: UploadTask): boolean {
  return task.status === "error" && classifyGalleryUploadFile(task.file) === "queued";
}

export function retryGalleryUpload(queue: readonly UploadTask[], taskId: string): UploadTask[] {
  return queue.map((task) =>
    task.id === taskId && canRetryGalleryUpload(task)
      ? { ...task, status: "queued", error: undefined }
      : task,
  );
}

export function removeGalleryUpload(queue: readonly UploadTask[], taskId: string): UploadTask[] {
  return queue.filter((task) => task.id !== taskId || task.status === "uploading");
}

export function restoreCancelledGalleryUpload(
  queue: readonly UploadTask[],
  taskId: string,
): UploadTask[] {
  return queue.map((task) =>
    task.id === taskId && task.status === "uploading"
      ? { ...task, status: "queued", error: undefined }
      : task,
  );
}

export function summarizeGalleryUploadBatch(total: number, failed: number) {
  return {
    total,
    succeeded: total - failed,
    failed,
  };
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

export function useGalleryPageController() {
  const { t } = useTranslation("gallery");
  const confirm = useConfirmDialog();
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
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim().toLowerCase();
  const [videoUrl, setVideoUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [uploadQueue, setUploadQueue] = useState<UploadTask[]>([]);
  const uploadQueueRef = useRef<UploadTask[]>(uploadQueue);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [addMediaModalOpen, addMediaModalHandlers] = useDisclosure(false);
  const [addMediaTab, setAddMediaTab] = useState<"image" | "video">("image");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  useEffect(() => {
    setSelectedIds([]);
  }, [typeFilter, sortOrder, dateFrom, dateTo, search]);

  // Keep ref in sync with state so runUploadQueue can read the latest queue
  // without taking it as a dependency (avoids the re-creation on every queue change).
  useEffect(() => {
    uploadQueueRef.current = uploadQueue;
  }, [uploadQueue]);

  useEffect(() => {
    return () => uploadAbortRef.current?.abort();
  }, []);

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
  const visibleSelectedIds = useMemo(
    () => getVisibleGallerySelection(selectedIds, rows.map((item) => item.id)),
    [rows, selectedIds],
  );
  const hasActiveFilters = Boolean(typeFilter || dateFrom || dateTo || search.trim());

  const lightboxItem = useMemo(() => rows.find((item) => item.id === lightboxId) ?? null, [lightboxId, rows]);
  const lightboxIndex = useMemo(() => rows.findIndex((item) => item.id === lightboxId), [lightboxId, rows]);

  const queuedCount = uploadQueue.filter((item) => item.status === "queued").length;
  const uploadingCount = uploadQueue.filter((item) => item.status === "uploading").length;

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectFiles = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const mapped = list.map<UploadTask>((file) => {
      const classification = classifyGalleryUploadFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        caption: "",
        status: classification === "queued" ? "queued" : "error",
        error:
          classification === "too-large"
            ? t("message.fileTooLarge", { fileName: file.name })
            : classification === "unsupported"
              ? t("message.unsupportedFileType", { fileName: file.name })
            : undefined,
      };
    });
    setUploadQueue((current) => [...current, ...mapped]);
  };

  const openAddMediaModal = (tab: "image" | "video") => {
    setAddMediaTab(tab);
    addMediaModalHandlers.open();
  };

  // runUploadQueue reads the current queue via ref so it remains referentially
  // stable across renders (only re-created when queryClient or t changes).
  // Behaviour is identical to the original: it snapshots the queued tasks at
  // call time and processes them sequentially.
  const runUploadQueue = useCallback(async () => {
    if (uploadAbortRef.current) {
      return;
    }

    const currentQueue = uploadQueueRef.current;
    const pending = currentQueue.filter((item) => item.status === "queued");
    if (pending.length === 0) {
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    let failedCount = 0;
    let succeededCount = 0;
    let cancelled = false;

    try {
      for (const task of pending) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }

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
          await uploadGalleryImages([task.file], [task.caption.trim() || undefined], {
            signal: controller.signal,
          });
          succeededCount++;
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
          if (controller.signal.aborted) {
            cancelled = true;
            setUploadQueue((current) => restoreCancelledGalleryUpload(current, task.id));
            break;
          }

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

      if (!cancelled || succeededCount > 0) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
      }
      if (!cancelled) {
        const summary = summarizeGalleryUploadBatch(pending.length, failedCount);
        if (summary.failed === 0) {
          notifySuccess(t("message.uploaded"));
        } else {
          notifyError(t("message.uploadBatchFailed", summary));
        }
      }
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
    }
  }, [queryClient, t]);

  const cancelUploadQueue = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploadQueue((current) => current.filter((item) => item.status !== "done"));
  }, []);

  const retryUpload = useCallback((taskId: string) => {
    setUploadQueue((current) => retryGalleryUpload(current, taskId));
  }, []);

  const removeUpload = useCallback((taskId: string) => {
    setUploadQueue((current) => removeGalleryUpload(current, taskId));
  }, []);

  const openLightboxAt = (index: number) => {
    if (rows.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, rows.length - 1));
    const target = rows[clampedIndex];
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

  useLoadWarningToast(galleryQuery.isError && rows.length > 0, t("common:loadErrorRetry"));

  const emptyTitle = hasActiveFilters ? t("empty.filtered") : t("empty.default");
  const emptyDescription = canUpload
    ? t("empty.hintUpload")
    : !user
      ? t("empty.guest")
      : undefined;

  const handleDeleteItem = async (id: string) => {
    const confirmed = await confirm({
      title: t("confirm.delete.title"),
      description: t("confirm.delete.description"),
      confirmLabel: t("action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (!confirmed) return false;
    return deleteMutation.mutateAsync(id).then(
      () => true,
      () => false,
    );
  };

  const handleAddVideo = () => {
    if (!isAllowedGalleryVideoUrl(videoUrl.trim())) {
      notifyError(t("message.videoHostUnsupported"));
      return;
    }
    createVideoMutation.mutate({
      type: "video",
      url: videoUrl,
      caption: videoCaption || undefined,
    });
  };

  const handleCaptionChange = (taskId: string, caption: string) => {
    setUploadQueue((current) =>
      current.map((item) => (item.id === taskId ? { ...item, caption } : item)),
    );
  };

  return {
    // permissions / view flags
    canUpload,
    canModerate,
    isExternalView,
    user,
    // filter state
    typeFilter,
    setTypeFilter,
    sortOrder,
    setSortOrder,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    search,
    setSearch,
    // video add state
    videoUrl,
    setVideoUrl,
    videoCaption,
    setVideoCaption,
    // upload queue
    uploadQueue,
    queuedCount,
    uploadingCount,
    selectFiles,
    runUploadQueue,
    cancelUploadQueue,
    clearFinishedUploads,
    handleCaptionChange,
    retryUpload,
    removeUpload,
    canRetryUpload: canRetryGalleryUpload,
    // modal
    addMediaModalOpen,
    addMediaModalHandlers,
    addMediaTab,
    setAddMediaTab,
    openAddMediaModal,
    // selection
    selectedIds: visibleSelectedIds,
    toggleSelect,
    bulkDeleteMutation,
    // gallery query
    galleryQuery,
    rows,
    emptyTitle,
    emptyDescription,
    hasActiveFilters,
    // lightbox
    lightboxId,
    setLightboxId,
    lightboxItem,
    lightboxIndex,
    lightboxZoom,
    setLightboxZoom,
    openLightboxPrev,
    openLightboxNext,
    // mutations
    deleteMutation,
    createVideoMutation,
    handleDeleteItem,
    handleAddVideo,
    // helpers
    resolveImageUrl: resolveGalleryMediaUrl,
    formatDateTime,
    toEmbedVideoUrl,
  };
}
