import {
  announcementEtag,
  type Announcement,
  type AnnouncementAttachment,
  type AnnouncementSummary,
  type PaginatedResponse,
} from "@guild/shared";
import {
  ANNOUNCEMENT_CATEGORIES,
  type AnnouncementCategory,
} from "@guild/shared/constants/announcements";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/tiptap-meta";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useRetainedQueryData } from "./useRetainedQueryData";
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
  fetchAnnouncement,
  fetchAnnouncements,
  recordAnnouncementView,
} from "../services/AnnouncementService";
import { queryKeys } from "../api/query-keys";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "../utils/datetime";
import { notifyError, notifySuccess } from "../utils/notifications";
import { requireSiteMediaPolicy, useSiteConfigStore } from "../stores/site-config";
import { resolveMediaUrl } from "../utils/media";

type AnnouncementSelection =
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

type AnnouncementListCache = InfiniteData<PaginatedResponse<AnnouncementSummary>>;

async function invalidateAnnouncementReads(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.latestAnnouncement() }),
  ]);
}

function selectionFromRoute(announcementId: string | null): AnnouncementSelection {
  return announcementId ? { kind: "selected", id: announcementId } : { kind: "none" };
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
    ...(payload.category !== undefined ? { category: payload.category } : {}),
    ...(payload.pinned !== undefined ? { pinned: payload.pinned } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.publish_at !== undefined ? { publish_at: payload.publish_at } : {}),
    updated_at: updatedAt,
  } satisfies Partial<AnnouncementSummary>;
}

export function useAnnouncementsController() {
  const { t } = useTranslation("announcements");
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { announcementId?: string };
  const routeAnnouncementId = params.announcementId ?? null;
  const routeLocation = useLocation({
    select: (location) => ({
      pathname: location.pathname,
      entryKey: location.state.__TSR_key ?? location.state.key ?? location.href,
    }),
  });
  const { pathname, entryKey: routeEntryKey } = routeLocation;
  const isCreateRoute = pathname === "/announcements/new";
  const isExternalView = useExternalView();
  const { showError } = useAppError();
  const mediaPolicy = useSiteConfigStore(requireSiteMediaPolicy);
  const attachmentMaxBytes = mediaPolicy.max_file_size_bytes.announcement_attachment;
  const attachmentQuota = mediaPolicy.quotas.announcement_attachments;
  const { canManage: canManagePermission } = useEffectivePermissions();

  const canManageContent = canManagePermission([
    "announcements.create",
    "announcements.edit",
    "announcements.archive",
    "announcements.delete",
  ]) && !isExternalView;
  const canEdit = canManagePermission(["announcements.edit"]) && !isExternalView;
  const canCreate = canManagePermission(["announcements.create"]) && !isExternalView;
  const canArchive = canManagePermission(["announcements.archive"]) && !isExternalView;
  const canDelete = canManagePermission(["announcements.delete"]) && !isExternalView;

  const [sortOrder, setSortOrder] = useState<AnnouncementSort>("updated_desc");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const effectiveStatusFilter = canManageContent ? statusFilter : undefined;
  const [categoryFilter, setCategoryFilter] = useState<AnnouncementCategory | undefined>(undefined);
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim();
  const [selection, setSelection] = useState<AnnouncementSelection>(() => selectionFromRoute(routeAnnouncementId));
  const selectedId = selection.kind === "selected" ? selection.id : null;
  const [isCreating, setIsCreating] = useState(false);
  const openCreating = useCallback(() => setIsCreating(true), []);
  const closeCreating = useCallback(() => setIsCreating(false), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AnnouncementCategory>("announcement");
  const [bodyJson, setBodyJson] = useState(TIPTAP_DEFAULT_JSON);
  const [pinned, setPinned] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const savePendingRef = useRef(false);
  const attachmentUploadPendingRef = useRef(false);
  const attachmentUploadSessionRef = useRef(0);
  const attachmentDraftScopeRef = useRef(isCreateRoute ? "new" : routeAnnouncementId ?? "list");
  const lastViewedAnnouncementRouteEntryRef = useRef<string | null>(null);
  const editorBaselineRef = useRef<Announcement | null>(null);

  useEffect(() => {
    if (!canManageContent && statusFilter !== undefined) {
      setStatusFilter(undefined);
    }
  }, [canManageContent, statusFilter]);

  const abandonPendingAttachmentUpload = useCallback(() => {
    attachmentUploadSessionRef.current += 1;
    attachmentUploadPendingRef.current = false;
    setAttachmentUploading(false);
  }, []);

  const adoptAnnouncementDraft = useCallback((announcement: Announcement) => {
    setTitle(announcement.title);
    setCategory(announcement.category);
    setBodyJson(announcement.body_json);
    setPinned(announcement.pinned);
    setPublishAt(toDateTimeLocalValue(announcement.publish_at));
    setAttachments(announcement.attachments);
  }, []);

  const setAnnouncementSelection = useCallback((
    next: AnnouncementSelection,
    options?: { replace?: boolean },
  ) => {
    setSelection(next);
    if (next.kind === "selected") {
      void navigate({
        to: "/announcements/$announcementId",
        params: { announcementId: next.id },
        replace: options?.replace,
        viewTransition: false,
      });
    } else {
      void navigate({
        to: "/announcements",
        replace: options?.replace,
        viewTransition: false,
      });
    }
  }, [navigate]);

  /**
   * 退出创建态并把草稿清空。
   * 必须同步落地：调用方紧接着就要导航，而未保存改动拦截器读的是已提交的 state，
   * 异步的 setState 会让它读到「还在创建、草稿是脏的」，凭空多问一句。
   */
  const discardCreateDraft = useCallback(() => {
    abandonPendingAttachmentUpload();
    flushSync(() => {
      closeCreating();
      setTitle("");
      setCategory("announcement");
      setBodyJson(TIPTAP_DEFAULT_JSON);
      setPinned(false);
      setPublishAt("");
      setAttachments([]);
      editorBaselineRef.current = null;
    });
  }, [abandonPendingAttachmentUpload, closeCreating]);

  const retainedListData = useRetainedQueryData();
  const listQuery = useInfiniteQuery({
    ...retainedListData,
    queryKey: queryKeys.announcements.list(
      effectiveStatusFilter ?? "all",
      categoryFilter ?? "all",
      debouncedSearch,
      sortOrder,
    ),
    queryFn: ({ pageParam }) =>
      fetchAnnouncements({
        page: pageParam,
        limit: 50,
        status: effectiveStatusFilter,
        category: categoryFilter,
        search: debouncedSearch || undefined,
        sort: sortOrder,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 10 * 60_000,
    enabled: pathname === "/announcements",
  });

  const pinnedQuery = useQuery({
    queryKey: queryKeys.announcements.pinned(),
    queryFn: () => fetchAnnouncements({
      page: 1,
      limit: 3,
      pinned: true,
      status: "published",
      sort: "updated_desc",
    }),
    staleTime: 10 * 60_000,
    enabled: pathname === "/announcements",
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.announcements.detail(selectedId),
    enabled: Boolean(selectedId),
    queryFn: () => fetchAnnouncement(selectedId as string),
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    const next = selectionFromRoute(routeAnnouncementId);
    const nextDraftScope = isCreateRoute ? "new" : routeAnnouncementId ?? "list";
    if (attachmentDraftScopeRef.current !== nextDraftScope) {
      abandonPendingAttachmentUpload();
      attachmentDraftScopeRef.current = nextDraftScope;
    }
    if (isCreateRoute && canCreate) openCreating();
    else closeCreating();
    setSelection((current) => sameSelection(current, next) ? current : next);
  }, [abandonPendingAttachmentUpload, canCreate, closeCreating, isCreateRoute, openCreating, routeAnnouncementId]);

  const recordViewMutation = useMutation({
    mutationFn: recordAnnouncementView,
    retry: false,
    onSuccess: ({ view_count }, id) => {
      queryClient.setQueryData<Announcement>(queryKeys.announcements.detail(id), (current) =>
        current ? { ...current, view_count } : current);
      for (const [key, current] of queryClient.getQueriesData<AnnouncementListCache>({
        queryKey: queryKeys.announcements.all,
      })) {
        if (!Array.isArray(key) || key[1] !== "list") continue;
        queryClient.setQueryData(key, updateAnnouncementPages(
          current,
          (items) => items.map((item) => item.id === id ? { ...item, view_count } : item),
        ));
      }
      queryClient.setQueryData<PaginatedResponse<AnnouncementSummary>>(
        queryKeys.announcements.pinned(),
        (current) => current ? {
          ...current,
          data: current.data.map((item) => item.id === id ? { ...item, view_count } : item),
        } : current,
      );
    },
    onError: (error, id) => {
      console.error(`[announcement-view] failed to count ${id}`, error);
    },
  });

  useEffect(() => {
    if (!routeAnnouncementId) return;
    if (pathname !== `/announcements/${encodeURIComponent(routeAnnouncementId)}`) return;
    if (selectedId !== routeAnnouncementId) return;
    if (!detailQuery.isSuccess || detailQuery.isFetching) return;
    if (lastViewedAnnouncementRouteEntryRef.current === routeEntryKey) return;
    lastViewedAnnouncementRouteEntryRef.current = routeEntryKey;
    recordViewMutation.mutate(selectedId);
  }, [detailQuery.isFetching, detailQuery.isSuccess, pathname, recordViewMutation, routeAnnouncementId, routeEntryKey, selectedId]);

  const createMutation = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async (data) => {
      notifySuccess(t("message.created"));
      await invalidateAnnouncementReads(queryClient);
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
      ifMatch: string;
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
      await invalidateAnnouncementReads(queryClient);
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
    mutationFn: ({ id, ifMatch }: { id: string; ifMatch: string }) => archiveAnnouncement(id, ifMatch),
    onMutate: async ({ id }) => {
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
      await invalidateAnnouncementReads(queryClient);
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
    mutationFn: ({ id, ifMatch }: { id: string; ifMatch: string }) => deleteAnnouncement(id, ifMatch),
    onMutate: async ({ id }) => {
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
      await invalidateAnnouncementReads(queryClient);
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
    if (!canManageContent) {
      raw = raw.filter((item) => item.status === "published" || item.status === "archived");
    }
    if (effectiveStatusFilter) {
      raw = raw.filter((item) => item.status === effectiveStatusFilter);
    } else if (!canManageContent) {
      raw = raw.filter((item) => item.status === "published");
    }
    return raw;
  }, [accumulatedAnnouncements, canManageContent, effectiveStatusFilter]);

  const listHasMore = !listQuery.isPlaceholderData && (listQuery.hasNextPage ?? false);

  const selected = detailQuery.data ?? null;

  useEffect(() => {
    if (isCreating) {
      editorBaselineRef.current = null;
      setTitle("");
      setCategory("announcement");
      setBodyJson(TIPTAP_DEFAULT_JSON);
      setPinned(false);
      setPublishAt("");
      setAttachments([]);
    } else if (selected) {
      const baseline = editorBaselineRef.current;
      if (!baseline || baseline.id !== selected.id) {
        editorBaselineRef.current = null;
        adoptAnnouncementDraft(selected);
      }
    }
  }, [adoptAnnouncementDraft, isCreating, selected]);

  const isDirty = useMemo(() => {
    if (isCreating ? !canCreate : !canEdit) return false;
    if (isCreating) {
      return title.trim().length > 0
        || category !== "announcement"
        || bodyJson !== TIPTAP_DEFAULT_JSON
        || pinned
        || publishAt.length > 0
        || attachments.length > 0;
    }
    const baseline = editorBaselineRef.current ?? selected;
    if (baseline) {
      return (
        title !== baseline.title ||
        category !== baseline.category ||
        bodyJson !== baseline.body_json ||
        pinned !== baseline.pinned ||
        publishAt !== toDateTimeLocalValue(baseline.publish_at) ||
        !sameAttachmentOrder(attachments, baseline.attachments)
      );
    }
    return false;
  }, [attachments, bodyJson, canCreate, canEdit, category, isCreating, pinned, publishAt, selected, title]);
  const isPublishReady = useMemo(
    () => title.trim().length > 0 && extractTipTapText(bodyJson).trim().length > 0,
    [bodyJson, title],
  );

  useBeforeUnloadPrompt(isDirty);

  const handleCreateByStatus = useCallback(() => {
    if (!canCreate) return;
    abandonPendingAttachmentUpload();
    attachmentDraftScopeRef.current = "new";
    editorBaselineRef.current = null;
    openCreating();
    setSelection({ kind: "none" });
    void navigate({ to: "/announcements/new", viewTransition: false });
  }, [abandonPendingAttachmentUpload, canCreate, navigate, openCreating]);

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
    if (isCreating) {
      discardCreateDraft();
    } else if (selected) {
      abandonPendingAttachmentUpload();
      /*
       * The custom discard confirmation and the router blocker observe the same draft.
       * Reset it synchronously before navigating so one explicit confirmation cannot be
       * followed by a second, global "unsaved changes" dialog over the destination page.
       */
      flushSync(() => {
        editorBaselineRef.current = null;
        adoptAnnouncementDraft(selected);
      });
      closeCreating();
    } else {
      abandonPendingAttachmentUpload();
      editorBaselineRef.current = null;
      closeCreating();
    }
    setAnnouncementSelection(
      id === null ? { kind: "none" } : { kind: "selected", id },
    );
    return true;
  }, [
    adoptAnnouncementDraft,
    abandonPendingAttachmentUpload,
    closeCreating,
    confirm,
    discardCreateDraft,
    isCreating,
    isDirty,
    selected,
    setAnnouncementSelection,
    t,
  ]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setStatusFilter(undefined);
    setCategoryFilter(undefined);
    setSortOrder("updated_desc");
  }, [setSearch]);

  const handleStartEditing = () => {
    if (!canEdit || !selected) return;
    editorBaselineRef.current = selected;
    adoptAnnouncementDraft(selected);
  };

  const handleFinish = async (mode: AnnouncementFinishMode): Promise<boolean> => {
    if (mode !== "archived" && !isPublishReady) return false;

    if (isCreating) {
      if (!canCreate || mode === "archived" || savePendingRef.current) return false;
      if (attachmentUploadPendingRef.current) return false;
      savePendingRef.current = true;

      const status = ANNOUNCEMENT_STATUS_BY_FINISH_MODE[mode];
      try {
        await createMutation.mutateAsync({
          title,
          category,
          body_json: bodyJson,
          pinned,
          status,
          publish_at: status === "published" ? new Date().toISOString() : fromDateTimeLocalValue(publishAt),
          attachment_media_ids: attachments.map((attachment) => attachment.media_id),
        });
        return true;
      } catch {
        return false;
      }
    }

    const baseline = editorBaselineRef.current ?? selected;
    if (!selectedId || !baseline || baseline.id !== selectedId) return false;
    const ifMatch = announcementEtag(baseline);

    if (mode === "archived") {
      if (!canArchive) return false;
      try {
        await archiveMutation.mutateAsync({ id: selectedId, ifMatch });
        editorBaselineRef.current = null;
        return true;
      } catch {
        return false;
      }
    }

    if (!canEdit || savePendingRef.current || attachmentUploadPendingRef.current) return false;
    savePendingRef.current = true;

    const status = ANNOUNCEMENT_STATUS_BY_FINISH_MODE[mode];
    try {
      const updated = await updateMutation.mutateAsync({
        id: selectedId,
        payload: {
          title,
          category,
          body_json: bodyJson,
          pinned,
          status,
          publish_at: status === "published"
            ? new Date().toISOString()
            : fromDateTimeLocalValue(publishAt) ?? null,
          ...(!sameAttachmentOrder(attachments, baseline.attachments)
            ? { attachment_media_ids: attachments.map((attachment) => attachment.media_id) }
            : {}),
        },
        ifMatch,
        attachments,
      });
      editorBaselineRef.current = null;
      adoptAnnouncementDraft(updated);
      return true;
    } catch {
      return false;
    }
  };

  const handleCloseEditor = () => {
    if (isCreating) {
      // 同 createMutation：取消同样要先把草稿清干净，否则这一跳会被未保存拦截器再问一次，
      // 而「取消」本身就是用户在明确表示要丢掉它。
      discardCreateDraft();
      setAnnouncementSelection({ kind: "none" });
      return;
    }
    if (!selected) return;
    abandonPendingAttachmentUpload();
    editorBaselineRef.current = null;
    adoptAnnouncementDraft(selected);
  };

  const handleDelete = async (): Promise<boolean> => {
    if (!canDelete) return false;
    const baseline = editorBaselineRef.current ?? selected;
    if (!selectedId || !baseline || baseline.id !== selectedId) return false;
    try {
      await deleteMutation.mutateAsync({ id: selectedId, ifMatch: announcementEtag(baseline) });
      editorBaselineRef.current = null;
      return true;
    } catch {
      return false;
    }
  };

  const handleUploadAnnouncementImages = async (file: File) => {
    if (isCreating ? !canCreate : !canEdit) {
      throw new Error("Announcement media upload is not permitted for this editor session");
    }
    const uploaded = await uploadPendingAnnouncementImages([file]);
    const mediaId = uploaded.media_ids[0];
    if (!mediaId) {
      throw new Error("Image upload returned no media id");
    }
    return resolveMediaUrl(mediaId);
  };

  const handleUploadAnnouncementAttachment = async (file: File) => {
    if (isCreating ? !canCreate : !canEdit) return;
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
    const uploadSession = attachmentUploadSessionRef.current;
    try {
      const uploaded = await uploadAnnouncementAttachment(file);
      if (uploadSession !== attachmentUploadSessionRef.current) return;
      setAttachments((current) => current.some(
        (attachment) => attachment.media_id === uploaded.attachment.media_id,
      ) ? current : [...current, uploaded.attachment]);
    } catch (error) {
      if (uploadSession !== attachmentUploadSessionRef.current) return;
      showError(error, t("message.attachmentUploadFailed"));
    } finally {
      if (uploadSession === attachmentUploadSessionRef.current) {
        attachmentUploadPendingRef.current = false;
        setAttachmentUploading(false);
      }
    }
  };

  const handleRemoveAnnouncementAttachment = (mediaId: string) => {
    if (isCreating ? !canCreate : !canEdit) return;
    setAttachments((current) => current.filter((attachment) => attachment.media_id !== mediaId));
  };

  return {
    canEdit,
    canCreate,
    canManageContent,
    canArchive,
    canDelete,
    sortOrder,
    setSortOrder,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    categoryOptions: ANNOUNCEMENT_CATEGORIES,
    search,
    setSearch,
    selectedId,
    setSelectedId: handleSelectId,
    isCreating,
    title,
    setTitle,
    category,
    setCategory,
    bodyJson,
    setBodyJson,
    pinned,
    setPinned,
    publishAt,
    setPublishAt,
    attachments,
    attachmentUploading,
    attachmentMaxBytes,
    attachmentQuota,
    listQuery,
    pinnedQuery,
    detailQuery,
    rows,
    pinnedRows: pinnedQuery.data?.data.slice(0, 3) ?? [],
    selected,
    listHasMore,
    listLoadingMore: listQuery.isFetchingNextPage,
    onLoadMoreList: () => { if (!listQuery.isPlaceholderData) void listQuery.fetchNextPage(); },
    isBusy: createMutation.isPending || updateMutation.isPending || archiveMutation.isPending || deleteMutation.isPending,
    savePending: createMutation.isPending || updateMutation.isPending,
    archivePending: archiveMutation.isPending,
    deletePending: deleteMutation.isPending,
    isDirty,
    isPublishReady,
    resetFilters,
    handleCreateByStatus,
    handleStartEditing,
    handleFinish,
    handleCloseEditor,
    handleDelete,
    handleUploadAnnouncementImages,
    handleUploadAnnouncementAttachment,
    handleRemoveAnnouncementAttachment,
  };
}
