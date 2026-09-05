import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useRetainedQueryData } from "./useRetainedQueryData";
import { galleryItemEtag, type CursorResponse, type GalleryItem } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { formatDateTimeWithTimeZone, localDayEndIso, localDayStartIso } from "../utils/datetime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useTranslation } from "react-i18next";
import {
  batchDeleteGalleryItems,
  createGalleryVideo,
  deleteGalleryItem,
  likeGalleryItem,
  unlikeGalleryItem,
  updateGalleryItem,
  uploadGalleryImages,
  fetchGallery,
} from "../services/GalleryService";
import { useAppError } from "./useAppError";
import { useExternalView } from "./useExternalView";
import { useLoadWarningToast } from "./useLoadWarningToast";
import { queryKeys } from "../api/query-keys";
import { notifySuccess, notifyError } from "../utils/notifications";
import { useAuthStore } from "../stores/auth";
import { requireSiteMediaPolicy, useSiteConfigStore } from "../stores/site-config";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { isAllowedGalleryVideoUrl, toEmbedVideoUrl } from "@guild/shared/utils/video";
import type { UploadTask } from "../types/media";
import { resolveMediaUrl } from "../utils/media";

export type GalleryUploadFileClassification = "queued" | "unsupported";

export function classifyGalleryUploadFile(
  file: Pick<File, "type" | "size">,
): GalleryUploadFileClassification {
  if (!file.type.startsWith("image/")) {
    return "unsupported";
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

export function hasUnsavedGalleryMediaDraft(
  queue: readonly UploadTask[],
  video: Readonly<{ url: string; title: string; description: string }>,
): boolean {
  return queue.some((task) => task.status !== "done")
    || video.url.trim().length > 0
    || video.title.trim().length > 0
    || video.description.trim().length > 0;
}

function defaultGalleryTitle(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./]+$/, "").trim();
  return (withoutExtension || fileName).slice(0, LIMITS.content.galleryTitle.max);
}

type GalleryDeleteTarget = Readonly<{
  id: string;
  ifMatch: string;
  settle(result: boolean): void;
}>;

export function useGalleryPageController() {
  const { t } = useTranslation("gallery");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const mediaPolicy = useSiteConfigStore(requireSiteMediaPolicy);
  const galleryImageQuota = mediaPolicy.quotas.gallery;
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const canDeleteGallery = canManagePermission(["gallery.delete"]);
  const canManageGallery = canManagePermission(["gallery.manage"]);
  const canUpload = canManagePermission(["gallery.upload"]) && !isExternalView;
  const canModerate = canDeleteGallery && !isExternalView;
  const canLike = Boolean(user) && !isExternalView;
  const { showError } = useAppError();

  const [typeFilter, setTypeFilter] = useState<"image" | "video" | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim().toLowerCase();
  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [uploadQueue, setUploadQueue] = useState<UploadTask[]>([]);
  const uploadQueueRef = useRef<UploadTask[]>(uploadQueue);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [addMediaModalOpen, setAddMediaModalOpen] = useState(false);
  const [addMediaTab, setAddMediaTab] = useState<"image" | "video">("image");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<GalleryDeleteTarget | null>(null);
  const deleteTargetRef = useRef<GalleryDeleteTarget | null>(null);
  const deleteCommitRef = useRef(false);
  const hasUnsavedMediaDraft = hasUnsavedGalleryMediaDraft(uploadQueue, {
    url: videoUrl,
    title: videoTitle,
    description: videoDescription,
  });
  useBeforeUnloadPrompt(hasUnsavedMediaDraft);

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

  const retainedListData = useRetainedQueryData();
  const galleryQuery = useInfiniteQuery({
    ...retainedListData,
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
        date_from: localDayStartIso(dateFrom),
        date_to: localDayEndIso(dateTo),
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
      setVideoTitle("");
      setVideoDescription("");
      setAddMediaModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
    },
    onError: (error) => {
      showError(error, t("message.videoCreateFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, ifMatch }: Pick<GalleryDeleteTarget, "id" | "ifMatch">) =>
      deleteGalleryItem(id, ifMatch),
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

  const likeMutation = useMutation({
    mutationFn: async ({ id, liked }: { id: string; liked: boolean }): Promise<{
      liked: boolean;
      like_count: number;
    }> => liked ? unlikeGalleryItem(id) : likeGalleryItem(id),
    onSuccess: (result, { id }) => {
      queryClient.setQueriesData<InfiniteData<CursorResponse<GalleryItem>>>({
        queryKey: queryKeys.gallery.all,
      }, (current) => current ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          data: page.data.map((item) => item.id === id
            ? { ...item, liked_by_viewer: result.liked, like_count: result.like_count }
            : item),
        })),
      } : current);
    },
    onError: (error) => {
      showError(error, t("message.likeFailed"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      title,
      description,
      ifMatch,
    }: {
      id: string;
      title: string;
      description: string | null;
      ifMatch: string;
    }) => updateGalleryItem(id, { title, description }, ifMatch),
    onSuccess: (updated) => {
      queryClient.setQueriesData<InfiniteData<CursorResponse<GalleryItem>>>(
        { queryKey: queryKeys.gallery.all },
        (current) => current ? {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            data: page.data.map((item) => item.id === updated.id ? updated : item),
          })),
        } : current,
      );
      notifySuccess(t("message.updated"));
    },
    onError: (error) => {
      showError(error, t("message.updateFailed"));
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

  const canEditGalleryItem = useCallback((item: GalleryItem) => (
    Boolean(user)
      && !isExternalView
      && (item.uploaded_by === user?.id || canManageGallery)
  ), [canManageGallery, isExternalView, user]);

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectFiles = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const maxQueueItems = Math.min(galleryImageQuota, 50);
    const remainingSlots = Math.max(0, maxQueueItems - uploadQueueRef.current.length);
    if (list.length > remainingSlots) {
      notifyError(t("message.fileQuotaExceeded", { max: maxQueueItems }));
    }
    if (remainingSlots === 0) return;
    const mapped = list.slice(0, remainingSlots).map<UploadTask>((file) => {
      const classification = classifyGalleryUploadFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        title: defaultGalleryTitle(file.name),
        description: "",
        status: classification === "queued" ? "queued" : "error",
        error:
          classification === "unsupported"
            ? t("message.unsupportedFileType", { fileName: file.name })
            : undefined,
      };
    });
    const nextQueue = [...uploadQueueRef.current, ...mapped];
    uploadQueueRef.current = nextQueue;
    setUploadQueue(nextQueue);
  };

  const openAddMediaModal = (tab: "image" | "video") => {
    setAddMediaTab(tab);
    setAddMediaModalOpen(true);
  };

  const closeAddMediaModal = () => {
    setAddMediaModalOpen(false);
  };

  // Snapshot the queue once and use the server's batch endpoint. The queue still
  // exposes per-file metadata and retry state, while one selection produces one request.
  const runUploadQueue = useCallback(async () => {
    if (uploadAbortRef.current) {
      return;
    }

    const currentQueue = uploadQueueRef.current;
    const pending = currentQueue.filter((item) => item.status === "queued");
    if (pending.length === 0) {
      return;
    }
    if (pending.some((item) => item.title.trim().length < LIMITS.content.galleryTitle.min)) {
      notifyError(t("message.titleRequired"));
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const pendingIds = new Set(pending.map(({ id }) => id));
      setUploadQueue((current) => current.map((item) => pendingIds.has(item.id)
        ? { ...item, status: "uploading", error: undefined }
        : item));

      await uploadGalleryImages(
        pending.map(({ file }) => file),
        pending.map(({ title, description }) => ({
          title: title.trim(),
          description: description.trim() || undefined,
        })),
        { signal: controller.signal },
      );

      setUploadQueue((current) => current.map((item) => pendingIds.has(item.id)
        ? { ...item, status: "done" }
        : item));
      await queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
      notifySuccess(t("message.uploaded"));
    } catch (error) {
      const pendingIds = new Set(pending.map(({ id }) => id));
      if (controller.signal.aborted) {
        setUploadQueue((current) => current.map((item) => pendingIds.has(item.id) && item.status === "uploading"
          ? { ...item, status: "queued", error: undefined }
          : item));
        return;
      }

      const fallback = t("message.uploadFailed");
      const errorText = error instanceof Error ? error.message : fallback;
      setUploadQueue((current) => current.map((item) => pendingIds.has(item.id)
        ? {
            ...item,
            status: "error",
            error: t("message.uploadTaskFailed", { error: errorText || fallback }),
          }
        : item));
      showError(error, t("message.uploadBatchFailed", summarizeGalleryUploadBatch(pending.length, pending.length)));
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
    }
  }, [queryClient, showError, t]);

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
  }, [lightboxItem]);

  useLoadWarningToast(galleryQuery.isError && rows.length > 0, t("common:loadErrorRetry"));

  const emptyTitle = hasActiveFilters ? t("empty.filtered") : t("empty.default");
  const emptyDescription = canUpload
    ? t("empty.hintUpload")
    : !user
      ? t("empty.guest")
      : undefined;

  const settleDeleteTarget = (target: GalleryDeleteTarget, result: boolean) => {
    if (deleteTargetRef.current !== target) return;
    deleteTargetRef.current = null;
    setDeleteTarget(null);
    target.settle(result);
  };

  const handleDeleteItem = (item: GalleryItem): Promise<boolean> => {
    if (deleteTargetRef.current) return Promise.resolve(false);
    let ifMatch: string;
    try {
      ifMatch = galleryItemEtag(item);
    } catch (error) {
      showError(error, t("message.deleteFailed"));
      return Promise.resolve(false);
    }
    return new Promise((settle) => {
      const target: GalleryDeleteTarget = { id: item.id, ifMatch, settle };
      deleteTargetRef.current = target;
      setDeleteTarget(target);
    });
  };

  const confirmDeleteItem = async (): Promise<boolean> => {
    const target = deleteTargetRef.current;
    if (!target || deleteCommitRef.current) return false;
    deleteCommitRef.current = true;
    try {
      await deleteMutation.mutateAsync({ id: target.id, ifMatch: target.ifMatch });
      settleDeleteTarget(target, true);
      return true;
    } catch {
      return false;
    } finally {
      deleteCommitRef.current = false;
    }
  };

  const cancelDeleteItem = () => {
    const target = deleteTargetRef.current;
    if (!target || deleteCommitRef.current) return;
    settleDeleteTarget(target, false);
  };

  const handleAddVideo = () => {
    const normalizedUrl = videoUrl.trim();
    const normalizedTitle = videoTitle.trim();
    if (!normalizedTitle) {
      notifyError(t("message.titleRequired"));
      return;
    }
    if (!isAllowedGalleryVideoUrl(normalizedUrl)) {
      notifyError(t("message.videoHostUnsupported"));
      return;
    }
    createVideoMutation.mutate({
      type: "video",
      url: normalizedUrl,
      title: normalizedTitle,
      description: videoDescription.trim() || undefined,
    });
  };

  const handleTitleChange = (taskId: string, title: string) => {
    setUploadQueue((current) =>
      current.map((item) => (item.id === taskId ? { ...item, title } : item)),
    );
  };

  const handleDescriptionChange = (taskId: string, description: string) => {
    setUploadQueue((current) =>
      current.map((item) => (item.id === taskId ? { ...item, description } : item)),
    );
  };

  const toggleLike = useCallback((id: string, liked: boolean) => (
    likeMutation.mutateAsync({ id, liked }).then(() => true, () => false)
  ), [likeMutation]);

  const updateGalleryMetadata = useCallback((
    item: GalleryItem,
    input: Readonly<{ title: string; description: string | null }>,
  ): Promise<boolean> => {
    if (!canEditGalleryItem(item)) return Promise.resolve(false);
    let ifMatch: string;
    try {
      ifMatch = galleryItemEtag(item);
    } catch (error) {
      showError(error, t("message.updateFailed"));
      return Promise.resolve(false);
    }
    return updateMutation.mutateAsync({ id: item.id, ...input, ifMatch }).then(
      () => true,
      () => false,
    );
  }, [canEditGalleryItem, showError, t, updateMutation]);

  return {
    // permissions / view flags
    canUpload,
    canModerate,
    canLike,
    canEditGalleryItem,
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
    videoTitle,
    setVideoTitle,
    videoDescription,
    setVideoDescription,
    // upload queue
    uploadQueue,
    galleryImageQuota,
    queuedCount,
    uploadingCount,
    selectFiles,
    runUploadQueue,
    cancelUploadQueue,
    clearFinishedUploads,
    handleTitleChange,
    handleDescriptionChange,
    retryUpload,
    removeUpload,
    canRetryUpload: canRetryGalleryUpload,
    // modal
    addMediaModalOpen,
    closeAddMediaModal,
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
    deleteTargetId: deleteTarget?.id ?? null,
    confirmDeleteItem,
    cancelDeleteItem,
    createVideoMutation,
    likePending: likeMutation.isPending,
    updatePending: updateMutation.isPending,
    toggleLike,
    updateGalleryMetadata,
    handleDeleteItem,
    handleAddVideo,
    // helpers
    resolveImageUrl: resolveMediaUrl,
    formatDateTime: formatDateTimeWithTimeZone,
    toEmbedVideoUrl,
  };
}
