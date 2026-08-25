import {
  type Announcement,
  type AnnouncementAttachment,
  type AnnouncementSummary,
  type PaginatedResponse,
} from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/tiptap-meta";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useExternalView } from "./useExternalView";
import { extractTipTapText } from "@guild/shared/utils/tiptap-text";
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  uploadAnnouncementAttachment,
  uploadPendingAnnouncementImages,
  type UpdateAnnouncementPayload,
  updateAnnouncement,
  uploadAnnouncementImages,
  fetchAnnouncement,
  fetchAnnouncements,
} from "../services/AnnouncementService";
import { queryKeys } from "../api/query-keys";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "../utils/datetime";
import { notifyError, notifySuccess } from "../utils/notifications";
import { useAuthStore } from "../stores/auth";
import { requireSiteMediaPolicy, useSiteConfigStore } from "../stores/site-config";
import { userScopedStorageKey } from "../session-storage";
import { resolveMediaUrl } from "../utils/media";

const ANNOUNCEMENTS_LAST_SEEN_STORAGE_KEY = "portal:last_seen";

type AnnouncementSelection =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "selected"; id: string };

type AnnouncementFinishMode = "none" | "draft" | "archived" | "scheduled";
type AnnouncementSort = "updated_desc" | "updated_asc";

const ANNOUNCEMENT_STATUS_BY_FINISH_MODE = {
  none: "published",
  draft: "draft",
  scheduled: "scheduled",
} satisfies Record<
  Exclude<AnnouncementFinishMode, "archived">,
  Announcement["status"]
>;

type AnnouncementRouteSearch = {
  announcementId?: string;
  selection?: "none";
};

type AnnouncementListCache = InfiniteData<PaginatedResponse<AnnouncementSummary>>;

function selectionFromRoute(search: AnnouncementRouteSearch): AnnouncementSelection {
  if (search.announcementId) return { kind: "selected", id: search.announcementId };
  if (search.selection === "none") return { kind: "none" };
  return { kind: "auto" };
}

function sameSelection(left: AnnouncementSelection, right: AnnouncementSelection): boolean {
  return left.kind === right.kind
    && (left.kind !== "selected" || (right.kind === "selected" && left.id === right.id));
}

function updateAnnouncementPages(
  current: AnnouncementListCache | undefined,
  update: (items: AnnouncementSummary[]) => AnnouncementSummary[],
): AnnouncementListCache | undefined {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: update(page.data),
    })),
  };
}

function flattenUniqueAnnouncements(data: AnnouncementListCache | undefined): AnnouncementSummary[] {
  const byId = new Map<string, AnnouncementSummary>();
  for (const page of data?.pages ?? []) {
    for (const announcement of page.data) {
      if (!byId.has(announcement.id)) byId.set(announcement.id, announcement);
    }
  }
  return [...byId.values()];
}

function sameAttachmentOrder(
  left: readonly AnnouncementAttachment[],
  right: readonly AnnouncementAttachment[],
): boolean {
  return left.length === right.length
    && left.every((attachment, index) => attachment.media_id === right[index]?.media_id);
}

function optimisticAnnouncementPatch(
  payload: UpdateAnnouncementPayload,
  updatedAt: string,
) {
  return {
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.pinned !== undefined ? { pinned: payload.pinned } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.publish_at !== undefined ? { publish_at: payload.publish_at } : {}),
    updated_at: updatedAt,
  } satisfies Partial<AnnouncementSummary>;
}

function readAnnouncementsLastSeenAt(storageKey: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      announcements?: { lastSeenAt?: string };
    };
    const value = parsed.announcements?.lastSeenAt;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function useAnnouncementsController() {
  const { t } = useTranslation("announcements");
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as AnnouncementRouteSearch;
  const isExternalView = useExternalView();
  const { showError } = useAppError();
  const mediaPolicy = useSiteConfigStore(requireSiteMediaPolicy);
  const attachmentMaxBytes = mediaPolicy.max_file_size_bytes.announcement_attachment;
  const attachmentQuota = mediaPolicy.quotas.announcement_attachments;
  const currentUserId = useAuthStore((state) => state.user?.id);
  const announcementsLastSeenStorageKey = userScopedStorageKey(
    ANNOUNCEMENTS_LAST_SEEN_STORAGE_KEY,
    currentUserId,
  );

  const { canManage: canManagePermission } = useEffectivePermissions();

  const isModerator = canManagePermission(["announcements.create", "announcements.edit", "announcements.archive", "announcements.delete"]);
  const canEdit = isModerator && !isExternalView;
  const canCreate = canManagePermission(["announcements.create"]) && !isExternalView;

  const [pinnedFilter, setPinnedFilter] = useState(false);
  const [sortOrder, setSortOrder] = useState<AnnouncementSort>("updated_desc");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim();
  const [selection, setSelection] = useState<AnnouncementSelection>(() => selectionFromRoute(routeSearch));
  const selectedId = selection.kind === "selected" ? selection.id : null;
  const [isCreating, setIsCreating] = useState(false);
  const openCreating = useCallback(() => setIsCreating(true), []);
  const closeCreating = useCallback(() => setIsCreating(false), []);
  const [title, setTitle] = useState("");
  const [bodyJson, setBodyJson] = useState(TIPTAP_DEFAULT_JSON);
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [announcementsLastSeenAt, setAnnouncementsLastSeenAt] = useState<string | null>(null);
  const savePendingRef = useRef(false);
  const attachmentUploadPendingRef = useRef(false);
  const isCreatingRef = useRef(isCreating);
  const closeCreatingRef = useRef(closeCreating);
  isCreatingRef.current = isCreating;
  closeCreatingRef.current = closeCreating;

  const setAnnouncementSelection = useCallback((
    next: AnnouncementSelection,
    options?: { replace?: boolean },
  ) => {
    setSelection(next);
    void navigate({
      to: "/announcements",
      search: (previous) => ({
        ...previous,
        announcementId: next.kind === "selected" ? next.id : undefined,
        selection: next.kind === "none" ? "none" as const : undefined,
      }),
      replace: options?.replace,
      viewTransition: false,
    });
  }, [navigate]);

  /**
   * 退出创建态并把草稿清空。
   * 必须同步落地：调用方紧接着就要导航，而未保存改动拦截器读的是已提交的 state，
   * 异步的 setState 会让它读到「还在创建、草稿是脏的」，凭空多问一句。
   */
  const discardCreateDraft = useCallback(() => {
    flushSync(() => {
      closeCreating();
      setTitle("");
      setBodyJson(TIPTAP_DEFAULT_JSON);
      setAttachments([]);
    });
  }, [closeCreating]);

  const listQuery = useInfiniteQuery({
    queryKey: queryKeys.announcements.list(pinnedFilter ? "pinned" : "all", statusFilter ?? "all", debouncedSearch, sortOrder),
    queryFn: ({ pageParam }) =>
      fetchAnnouncements({
        page: pageParam,
        limit: 50,
        status: statusFilter,
        pinned: pinnedFilter ? true : undefined,
        search: debouncedSearch || undefined,
        archived: statusFilter === undefined ? undefined : statusFilter === "archived",
        sort: sortOrder,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 10 * 60_000,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.announcements.detail(selectedId),
    enabled: Boolean(selectedId),
    queryFn: () => fetchAnnouncement(selectedId as string),
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    const next = selectionFromRoute(routeSearch);
    if (isCreatingRef.current && next.kind !== "none") {
      closeCreatingRef.current();
    }
    setSelection((current) => sameSelection(current, next) ? current : next);
  }, [routeSearch.announcementId, routeSearch.selection]);

  const createMutation = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async (data) => {
      notifySuccess(t("message.created"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      /*
       * 先把创建态的草稿清干净再跳转。跳转要经过未保存改动拦截器（useBeforeUnloadPrompt），
       * 草稿还在的话，用户刚点完「发布」就会被问「有未保存的改动，确定离开吗」；
       * 选 Stay 更糟——公告已经建出来了，地址栏却停在 ?selection=none，选中的是空。
       * flushSync 是为了让拦截器在这次跳转被评估之前就看到已经不脏的状态，
       * 否则 setState 还没落地，拦截器读到的仍是旧值。
       */
      discardCreateDraft();
      setAnnouncementSelection({ kind: "selected", id: data.id });
    },
    onError: (error) => {
      showError(error, t("message.createFailed"));
    },
    onSettled: () => {
      savePendingRef.current = false;
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload, ifMatch }: {
      id: string;
      payload: UpdateAnnouncementPayload;
      ifMatch?: string;
      attachments: AnnouncementAttachment[];
    }) => updateAnnouncement(id, payload, ifMatch),
    onMutate: async ({ id, payload, attachments: nextAttachments }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.announcements.all });

      const previousLists = queryClient
        .getQueriesData<AnnouncementListCache>({ queryKey: queryKeys.announcements.all })
        .filter(([key]) => Array.isArray(key) && key[1] === "list");
      const previousDetail = queryClient.getQueryData<Announcement>(queryKeys.announcements.detail(id));
      const nowIso = new Date().toISOString();
      const optimisticPatch = optimisticAnnouncementPatch(payload, nowIso);

      for (const [key] of previousLists) {
        queryClient.setQueryData<AnnouncementListCache>(key, (current) => {
          const shouldRemove = payload.pinned === false && Array.isArray(key) && key[2] === "pinned";
          return updateAnnouncementPages(
            current,
            (items) => shouldRemove
              ? items.filter((item) => item.id !== id)
              : items.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        ...optimisticPatch,
                      }
                    : item,
                ),
          );
        });
      }

      queryClient.setQueryData<Announcement>(queryKeys.announcements.detail(id), (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          ...optimisticPatch,
          ...(payload.body_json !== undefined ? { body_json: payload.body_json } : {}),
          ...(payload.attachment_media_ids !== undefined ? { attachments: nextAttachments } : {}),
        };
      });

      return { previousLists, previousDetail };
    },
    onSuccess: async () => {
      notifySuccess(t("message.saved"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      if (selectedId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.detail(selectedId) });
      }
    },
    onError: (error, variables, context) => {
      if (context) {
        for (const [key, previous] of context.previousLists) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(queryKeys.announcements.detail(variables.id), context.previousDetail);
      }
      showError(error, t("message.saveFailed"));
    },
    onSettled: () => {
      savePendingRef.current = false;
    },
  });

  const archiveMutation = useMutation({
    mutationFn: archiveAnnouncement,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.announcements.all });
      const previousLists = queryClient
        .getQueriesData<AnnouncementListCache>({ queryKey: queryKeys.announcements.all })
        .filter(([key]) => Array.isArray(key) && key[1] === "list");

      for (const [key] of previousLists) {
        queryClient.setQueryData<AnnouncementListCache>(key, (current) =>
          updateAnnouncementPages(current, (items) => items.filter((item) => item.id !== id)));
      }

      return { previousLists };
    },
    onSuccess: async () => {
      notifySuccess(t("message.archived"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      setAnnouncementSelection({ kind: "none" }, { replace: true });
    },
    onError: (error, _variables, context) => {
      if (context) {
        for (const [key, previous] of context.previousLists) {
          queryClient.setQueryData(key, previous);
        }
      }
      showError(error, t("message.archiveFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAnnouncement,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.announcements.all });
      const previousLists = queryClient
        .getQueriesData<AnnouncementListCache>({ queryKey: queryKeys.announcements.all })
        .filter(([key]) => Array.isArray(key) && key[1] === "list");

      for (const [key] of previousLists) {
        queryClient.setQueryData<AnnouncementListCache>(key, (current) =>
          updateAnnouncementPages(current, (items) => items.filter((item) => item.id !== id)));
      }

      return { previousLists };
    },
    onSuccess: async () => {
      notifySuccess(t("message.deleted"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      setAnnouncementSelection({ kind: "none" }, { replace: true });
    },
    onError: (error, _variables, context) => {
      if (context) {
        for (const [key, previous] of context.previousLists) {
          queryClient.setQueryData(key, previous);
        }
      }
      showError(error, t("message.deleteFailed"));
    },
  });

  const accumulatedAnnouncements = useMemo(
    () => flattenUniqueAnnouncements(listQuery.data),
    [listQuery.data],
  );

  const rows = useMemo(() => {
    let raw = accumulatedAnnouncements;
    if (!canEdit) {
      raw = raw.filter((item) => item.status === "published" || item.status === "archived");
    }
    if (statusFilter) {
      raw = raw.filter((item) => item.status === statusFilter);
    } else if (!canEdit) {
      raw = raw.filter((item) => item.status === "published");
    }
    if (pinnedFilter) {
      raw = raw.filter((item) => item.pinned);
    }
    return raw;
  }, [canEdit, accumulatedAnnouncements, pinnedFilter, statusFilter]);

  const listHasMore = listQuery.hasNextPage ?? false;

  const selected = detailQuery.data ?? null;

  useEffect(() => {
    setAnnouncementsLastSeenAt(readAnnouncementsLastSeenAt(announcementsLastSeenStorageKey));
  }, [announcementsLastSeenStorageKey]);

  useEffect(() => {
    if (isCreating || selection.kind !== "auto") return;
    const firstId = rows[0]?.id;
    if (firstId) {
      setAnnouncementSelection({ kind: "selected", id: firstId }, { replace: true });
    }
  }, [isCreating, rows, selection.kind, setAnnouncementSelection]);

  useEffect(() => {
    if (isCreating) {
      setTitle("");
      setBodyJson(TIPTAP_DEFAULT_JSON);
      setPinned(false);
      setArchived(false);
      setDraftEnabled(false);
      setPublishAt("");
      setScheduleEnabled(false);
      setAttachments([]);
    } else if (selected) {
      setTitle(selected.title);
      setBodyJson(selected.body_json);
      setPinned(selected.pinned);
      setArchived(selected.status === "archived");
      setDraftEnabled(selected.status === "draft");
      setPublishAt(toDateTimeLocalValue(selected.publish_at));
      setScheduleEnabled(selected.status === "scheduled");
      setAttachments(selected.attachments);
    }
  }, [isCreating, selected]);

  const isDirty = useMemo(() => {
    if (!canEdit) return false;
    if (isCreating) {
      return title.trim().length > 0
        || bodyJson !== TIPTAP_DEFAULT_JSON
        || pinned
        || publishAt.length > 0
        || attachments.length > 0;
    }
    if (selected) {
      return (
        title !== selected.title ||
        bodyJson !== selected.body_json ||
        pinned !== selected.pinned ||
        publishAt !== toDateTimeLocalValue(selected.publish_at) ||
        scheduleEnabled !== (selected.status === "scheduled") ||
        draftEnabled !== (selected.status === "draft") ||
        archived !== (selected.status === "archived") ||
        !sameAttachmentOrder(attachments, selected.attachments)
      );
    }
    return false;
  }, [archived, attachments, bodyJson, canEdit, draftEnabled, isCreating, pinned, publishAt, scheduleEnabled, selected, title]);
  const isPublishReady = useMemo(
    () => title.trim().length > 0 && extractTipTapText(bodyJson).trim().length > 0,
    [bodyJson, title],
  );

  useBeforeUnloadPrompt(isDirty);

  const handleCreateByStatus = useCallback(() => {
    if (!canCreate) return;
    openCreating();
    setAnnouncementSelection({ kind: "none" });
  }, [canCreate, openCreating, setAnnouncementSelection]);

  const handleSelectId = useCallback(async (id: string | null) => {
    if (isDirty) {
      const confirmed = await confirm({
        title: t("confirm.discardUnsaved.title"),
        description: t("confirm.discardUnsaved.description"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("action.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return false;
      }
    }
    if (id !== null) {
      closeCreating();
    }
    setAnnouncementSelection(
      id === null ? { kind: "none" } : { kind: "selected", id },
    );
    return true;
  }, [closeCreating, confirm, isDirty, setAnnouncementSelection, t]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setStatusFilter(undefined);
    setPinnedFilter(false);
    setSortOrder("updated_desc");
  }, []);

  const handleFinish = (mode: AnnouncementFinishMode) => {
    if (!isPublishReady) return;

    if (isCreating) {
      if (mode === "archived") return;
      if (savePendingRef.current) return;
      savePendingRef.current = true;

      const status = ANNOUNCEMENT_STATUS_BY_FINISH_MODE[mode];

      createMutation.mutate({
        title,
        body_json: bodyJson,
        pinned,
        status,
        publish_at: status === "published" ? new Date().toISOString() : fromDateTimeLocalValue(publishAt),
        attachment_media_ids: attachments.map((attachment) => attachment.media_id),
      });
      return;
    }

    if (!selectedId || !selected) return;

    if (mode === "archived") {
      archiveMutation.mutate(selectedId);
      return;
    }

    if (savePendingRef.current) return;
    savePendingRef.current = true;

    const status = ANNOUNCEMENT_STATUS_BY_FINISH_MODE[mode];

    updateMutation.mutate({
      id: selectedId,
      payload: {
        title,
        body_json: bodyJson,
        pinned,
        status,
        publish_at: status === "published"
          ? new Date().toISOString()
          : fromDateTimeLocalValue(publishAt) ?? null,
        ...(!sameAttachmentOrder(attachments, selected.attachments)
          ? { attachment_media_ids: attachments.map((attachment) => attachment.media_id) }
          : {}),
      },
      ifMatch: `"announcement-${selected.id}-${selected.updated_at}"`,
      attachments,
    });
  };

  const handleCloseEditor = () => {
    if (isCreating) {
      // 同 createMutation：取消同样要先把草稿清干净，否则这一跳会被未保存拦截器再问一次，
      // 而「取消」本身就是用户在明确表示要丢掉它。
      discardCreateDraft();
      const firstId = rows[0]?.id;
      setAnnouncementSelection(
        firstId ? { kind: "selected", id: firstId } : { kind: "none" },
      );
      return;
    }
    if (!selected) return;
    setTitle(selected.title);
    setBodyJson(selected.body_json);
    setPinned(selected.pinned);
    setArchived(selected.status === "archived");
    setDraftEnabled(selected.status === "draft");
    setPublishAt(toDateTimeLocalValue(selected.publish_at));
    setScheduleEnabled(selected.status === "scheduled");
    setAttachments(selected.attachments);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deleteMutation.mutate(selectedId);
  };

  const handleUploadAnnouncementImages = async (file: File) => {
    if (isCreating || !selectedId) {
      const uploaded = await uploadPendingAnnouncementImages([file]);
      const mediaId = uploaded.media_ids[0];
      if (!mediaId) {
        throw new Error("Image upload returned no media id");
      }
      return resolveMediaUrl(mediaId);
    }

    const uploaded = await uploadAnnouncementImages(selectedId, [file]);
    const mediaId = uploaded.media_ids[0];
    if (!mediaId) {
      throw new Error("Image upload returned no media id");
    }
    return resolveMediaUrl(mediaId);
  };

  const handleUploadAnnouncementAttachment = async (file: File) => {
    if (attachments.length >= attachmentQuota) {
      notifyError(t("validation.attachmentQuota", { count: attachmentQuota }));
      return;
    }
    if (file.size > attachmentMaxBytes) {
      notifyError(t("validation.attachmentSize", {
        size: Math.floor(attachmentMaxBytes / 1024 / 1024),
      }));
      return;
    }
    if (attachmentUploadPendingRef.current) return;
    attachmentUploadPendingRef.current = true;
    setAttachmentUploading(true);
    try {
      const uploaded = await uploadAnnouncementAttachment(file);
      setAttachments((current) => current.some(
        (attachment) => attachment.media_id === uploaded.attachment.media_id,
      ) ? current : [...current, uploaded.attachment]);
    } catch (error) {
      showError(error, t("message.attachmentUploadFailed"));
    } finally {
      attachmentUploadPendingRef.current = false;
      setAttachmentUploading(false);
    }
  };

  const handleRemoveAnnouncementAttachment = (mediaId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.media_id !== mediaId));
  };

  return {
    canEdit,
    canCreate,
    pinnedFilter,
    sortOrder,
    setSortOrder,
    setPinnedFilter,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    selectedId,
    setSelectedId: handleSelectId,
    isCreating,
    title,
    setTitle,
    bodyJson,
    setBodyJson,
    pinned,
    setPinned,
    archived,
    setArchived,
    draftEnabled,
    setDraftEnabled,
    publishAt,
    setPublishAt,
    scheduleEnabled,
    setScheduleEnabled,
    attachments,
    attachmentUploading,
    attachmentMaxBytes,
    attachmentQuota,
    announcementsLastSeenAt,
    listQuery,
    detailQuery,
    rows,
    selected,
    listHasMore,
    listLoadingMore: listQuery.isFetchingNextPage,
    onLoadMoreList: () => void listQuery.fetchNextPage(),
    isBusy: createMutation.isPending || updateMutation.isPending || archiveMutation.isPending || deleteMutation.isPending,
    savePending: createMutation.isPending || updateMutation.isPending,
    deletePending: deleteMutation.isPending,
    isDirty,
    isPublishReady,
    resetFilters,
    handleCreateByStatus,
    handleFinish,
    handleCloseEditor,
    handleDelete,
    handleUploadAnnouncementImages,
    handleUploadAnnouncementAttachment,
    handleRemoveAnnouncementAttachment,
  };
}
