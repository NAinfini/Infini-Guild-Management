import { type Announcement, type PaginatedResponse } from "@guild/shared";
import { useConfirmDialog } from "@portal/components/shared/ConfirmDialog";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/tiptap-meta";
import { notifications } from "@mantine/notifications";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { format, isValid, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useExternalView } from "./useExternalView";
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  stageAnnouncementImages,
  type UpdateAnnouncementPayload,
  updateAnnouncement,
  uploadAnnouncementImages,
  fetchAnnouncement,
  fetchAnnouncements,
} from "../services/AnnouncementService";
import { queryKeys } from "../api/query-keys";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { toIsoOrUndefined } from "../utils/iso-dates";

function buildAnnouncementImageUrl(key: string): string {
  if (/^(?:https?:)?\/\//i.test(key) || key.startsWith("data:")) return key;
  const path = `/api/announcements/image?key=${encodeURIComponent(key)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

const message = {
  success: (text: string) => notifications.show({ color: "green", message: text, autoClose: 3000 }),
};

type AnnouncementSelection =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "selected"; id: string };

type AnnouncementRouteSearch = {
  announcementId?: string;
  selection?: "none";
};

type AnnouncementListCache = InfiniteData<PaginatedResponse<Announcement>>;

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
  update: (items: Announcement[]) => Announcement[],
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

function flattenUniqueAnnouncements(data: AnnouncementListCache | undefined): Announcement[] {
  const byId = new Map<string, Announcement>();
  for (const page of data?.pages ?? []) {
    for (const announcement of page.data) {
      if (!byId.has(announcement.id)) byId.set(announcement.id, announcement);
    }
  }
  return [...byId.values()];
}

function toDateTimePickerValue(iso: string | null): string {
  if (!iso) return "";
  const date = parseISO(iso);
  if (!isValid(date)) return "";
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

function readAnnouncementsLastSeenAt(): string | null {
  try {
    const raw = localStorage.getItem("portal:last_seen");
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

  const { canManage: canManagePermission } = useEffectivePermissions();

  const isModerator = canManagePermission(["announcements.create", "announcements.edit", "announcements.archive", "announcements.delete"]);
  const canEdit = isModerator && !isExternalView;

  const [pinnedFilter, setPinnedFilter] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim();
  const [selection, setSelection] = useState<AnnouncementSelection>(() => selectionFromRoute(routeSearch));
  const selectedId = selection.kind === "selected" ? selection.id : null;
  const [isCreating, isCreatingHandlers] = useDisclosure(false);
  const [imageStagingToken, setImageStagingToken] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyJson, setBodyJson] = useState(TIPTAP_DEFAULT_JSON);
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [announcementsLastSeenAt, setAnnouncementsLastSeenAt] = useState<string | null>(null);

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

  const listQuery = useInfiniteQuery({
    queryKey: queryKeys.announcements.list(pinnedFilter ? "pinned" : "all", statusFilter ?? "all", debouncedSearch),
    queryFn: ({ pageParam }) =>
      fetchAnnouncements({
        page: pageParam,
        limit: 50,
        status: statusFilter,
        pinned: pinnedFilter ? true : undefined,
        search: debouncedSearch || undefined,
        archived: statusFilter === "archived",
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
    setSelection((current) => sameSelection(current, next) ? current : next);
  }, [routeSearch.announcementId, routeSearch.selection]);

  const createMutation = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async (data) => {
      message.success(t("message.created"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      isCreatingHandlers.close();
      setImageStagingToken(null);
      setAnnouncementSelection({ kind: "selected", id: data.id });
    },
    onError: (error) => {
      showError(error, t("message.createFailed"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload, ifMatch }: { id: string; payload: UpdateAnnouncementPayload; ifMatch?: string }) => updateAnnouncement(id, payload, ifMatch),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.announcements.all });

      const previousLists = queryClient
        .getQueriesData<AnnouncementListCache>({ queryKey: queryKeys.announcements.all })
        .filter(([key]) => Array.isArray(key) && key[1] === "list");
      const previousDetail = queryClient.getQueryData<Announcement>(queryKeys.announcements.detail(id));
      const nowIso = new Date().toISOString();

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
                        ...(payload as Partial<Announcement>),
                        updated_at: nowIso,
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
          ...(payload as Partial<Announcement>),
          updated_at: nowIso,
        };
      });

      return { previousLists, previousDetail };
    },
    onSuccess: async () => {
      message.success(t("message.saved"));
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
      message.success(t("message.archived"));
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
      message.success(t("message.deleted"));
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
    return [...raw].sort((left, right) => {
      if (left.pinned === right.pinned) {
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      }
      return left.pinned ? -1 : 1;
    });
  }, [canEdit, accumulatedAnnouncements, pinnedFilter, statusFilter]);

  const listHasMore = listQuery.hasNextPage ?? false;

  const selected = detailQuery.data ?? null;

  useEffect(() => {
    setAnnouncementsLastSeenAt(readAnnouncementsLastSeenAt());
  }, []);

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
    } else if (selected) {
      setTitle(selected.title);
      setBodyJson(selected.body_json);
      setPinned(selected.pinned);
      setArchived(selected.status === "archived");
      setDraftEnabled(selected.status === "draft");
      setPublishAt(toDateTimePickerValue(selected.publish_at));
      setScheduleEnabled(selected.status === "scheduled");
    }
  }, [isCreating, selected]);

  const isDirty = useMemo(() => {
    if (!canEdit) return false;
    if (isCreating) {
      return title.trim().length > 0 || bodyJson !== TIPTAP_DEFAULT_JSON;
    }
    if (selected) {
      return (
        title !== selected.title ||
        bodyJson !== selected.body_json ||
        pinned !== selected.pinned ||
        publishAt !== toDateTimePickerValue(selected.publish_at) ||
        scheduleEnabled !== (selected.status === "scheduled") ||
        draftEnabled !== (selected.status === "draft") ||
        archived !== (selected.status === "archived")
      );
    }
    return false;
  }, [archived, bodyJson, canEdit, draftEnabled, isCreating, pinned, publishAt, scheduleEnabled, selected, title]);

  useBeforeUnloadPrompt(isDirty);

  const handleCreateByStatus = useCallback(() => {
    isCreatingHandlers.open();
    setImageStagingToken(null);
    setAnnouncementSelection({ kind: "none" });
  }, [isCreatingHandlers, setAnnouncementSelection]);

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
        return;
      }
    }
    if (id !== null) {
      isCreatingHandlers.close();
    }
    setAnnouncementSelection(
      id === null ? { kind: "none" } : { kind: "selected", id },
    );
  }, [confirm, isDirty, isCreatingHandlers, setAnnouncementSelection, t]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setStatusFilter(undefined);
    setPinnedFilter(false);
  }, []);

  const handleFinish = (mode: "none" | "draft" | "archived" | "scheduled") => {
    if (isCreating) {
      if (mode === "archived") return;

      const statusMap: Record<string, Announcement["status"]> = {
        none: "published",
        draft: "draft",
        scheduled: "scheduled",
      };
      const status = statusMap[mode] ?? "published";

      createMutation.mutate({
        title,
        body_json: bodyJson,
        pinned,
        status,
        publish_at: status === "published" ? new Date().toISOString() : toIsoOrUndefined(publishAt),
        staging_token: imageStagingToken ?? undefined,
      });
      return;
    }

    if (!selectedId || !selected) return;

    if (mode === "archived") {
      archiveMutation.mutate(selectedId);
      return;
    }

    const statusMap: Record<string, Announcement["status"]> = {
      none: "published",
      draft: "draft",
      scheduled: "scheduled",
    };
    const status = statusMap[mode] ?? "published";

    updateMutation.mutate({
      id: selectedId,
      payload: {
        title,
        body_json: bodyJson,
        pinned,
        status,
        publish_at: status === "published" ? new Date().toISOString() : toIsoOrUndefined(publishAt),
      },
      ifMatch: `"announcement-${selected.id}-${selected.updated_at}"`,
    });
  };

  const handleCloseEditor = () => {
    if (isCreating) {
      isCreatingHandlers.close();
      setImageStagingToken(null);
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
    setPublishAt(toDateTimePickerValue(selected.publish_at));
    setScheduleEnabled(selected.status === "scheduled");
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deleteMutation.mutate(selectedId);
  };

  const handleUploadAnnouncementImages = async (file: File) => {
    if (isCreating || !selectedId) {
      const staged = await stageAnnouncementImages(imageStagingToken, [file]);
      setImageStagingToken(staged.staging_token);
      const stagedKey = staged.keys[0];
      if (!stagedKey) {
        throw new Error("Image staging returned no key");
      }
      return buildAnnouncementImageUrl(stagedKey);
    }

    const uploaded = await uploadAnnouncementImages(selectedId, [file]);
    const key = uploaded.keys[0];
    if (!key) {
      throw new Error("Image upload returned no key");
    }
    return buildAnnouncementImageUrl(key);
  };

  return {
    canEdit,
    pinnedFilter,
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
    announcementsLastSeenAt,
    listQuery,
    detailQuery,
    rows,
    selected,
    listHasMore,
    listLoadingMore: listQuery.isFetchingNextPage,
    onLoadMoreList: () => void listQuery.fetchNextPage(),
    isBusy: createMutation.isPending || updateMutation.isPending || archiveMutation.isPending || deleteMutation.isPending,
    savePending: updateMutation.isPending,
    deletePending: deleteMutation.isPending,
    isDirty,
    resetFilters,
    handleCreateByStatus,
    handleFinish,
    handleCloseEditor,
    handleDelete,
    handleUploadAnnouncementImages,
  };
}
