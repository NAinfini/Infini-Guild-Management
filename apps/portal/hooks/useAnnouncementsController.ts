import { type Announcement, type PaginatedResponse } from "@guild/shared";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/TipTapEditor";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useExternalView } from "./useExternalView";
import {
  archiveAnnouncement,
  createAnnouncement,
  type UpdateAnnouncementPayload,
  updateAnnouncement,
  uploadAnnouncementImages,
  fetchAnnouncement,
  fetchAnnouncements,
} from "../services/AnnouncementService";
import { queryKeys } from "../api/query-keys";
import { useEffectivePermissions } from "./useEffectivePermissions";

function buildAnnouncementImageUrl(key: string): string {
  if (/^(?:https?:)?\/\//i.test(key) || key.startsWith("data:")) return key;
  const path = `/api/announcements/image?key=${encodeURIComponent(key)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

const message = {
  success: (text: string) => notifications.show({ color: "green", message: text, autoClose: 3000 }),
};

function toIsoOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
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
  const queryClient = useQueryClient();
  const isExternalView = useExternalView();
  const { showError } = useAppError();

  const { canManage: canManagePermission } = useEffectivePermissions();

  const isModerator = canManagePermission(["announcements.create", "announcements.edit", "announcements.archive"]);
  const canEdit = isModerator && !isExternalView;

  const [pinnedFilter, setPinnedFilter] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [debouncedSearchRaw] = useDebouncedValue(search, 300);
  const debouncedSearch = debouncedSearchRaw.trim();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, isCreatingHandlers] = useDisclosure(false);
  const [draftAnnouncementId, setDraftAnnouncementId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyJson, setBodyJson] = useState(TIPTAP_DEFAULT_JSON);
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [announcementsLastSeenAt, setAnnouncementsLastSeenAt] = useState<string | null>(null);

  const [listPage, setListPage] = useState(1);
  const accumulatedAnnouncementsRef = useRef<Announcement[]>([]);
  const [accumulatedAnnouncements, setAccumulatedAnnouncements] = useState<Announcement[]>([]);
  const [listTotal, setListTotal] = useState(0);

  const listQuery = useQuery({
    queryKey: queryKeys.announcements.list(pinnedFilter ? "pinned" : "all", statusFilter ?? "all", debouncedSearch, listPage),
    queryFn: () =>
      fetchAnnouncements({
        page: listPage,
        limit: 50,
        status: statusFilter,
        pinned: pinnedFilter ? true : undefined,
        search: debouncedSearch || undefined,
        archived: statusFilter === "archived",
      }),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.announcements.detail(selectedId),
    enabled: Boolean(selectedId),
    queryFn: () => fetchAnnouncement(selectedId as string),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async (data) => {
      message.success(t("message.created"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      isCreatingHandlers.close();
      setSelectedId(data.id);
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
        .getQueriesData<PaginatedResponse<Announcement>>({ queryKey: queryKeys.announcements.all })
        .filter(([key]) => !(Array.isArray(key) && key[1] === "detail"));
      const previousDetail = queryClient.getQueryData<Announcement>(queryKeys.announcements.detail(id));
      const nowIso = new Date().toISOString();

      for (const [key] of previousLists) {
        queryClient.setQueryData<PaginatedResponse<Announcement>>(key, (current) => {
          if (!current) {
            return current;
          }
          const shouldRemove = payload.pinned === false && pinnedFilter;
          return {
            ...current,
            data: shouldRemove
              ? current.data.filter((item) => item.id !== id)
              : current.data.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        ...(payload as Partial<Announcement>),
                        updated_at: nowIso,
                      }
                    : item,
                ),
          };
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
        .getQueriesData<PaginatedResponse<Announcement>>({ queryKey: queryKeys.announcements.all })
        .filter(([key]) => !(Array.isArray(key) && key[1] === "detail"));

      for (const [key] of previousLists) {
        queryClient.setQueryData<PaginatedResponse<Announcement>>(key, (current) => {
          if (!current) return current;
          return {
            ...current,
            data: current.data.filter((item) => item.id !== id),
          };
        });
      }

      return { previousLists };
    },
    onSuccess: async () => {
      message.success(t("message.archived"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      setSelectedId(null);
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

  const listHasMore = accumulatedAnnouncements.length < listTotal;

  const selected = detailQuery.data ?? null;

  useEffect(() => {
    setAnnouncementsLastSeenAt(readAnnouncementsLastSeenAt());
  }, []);

  // Reset accumulated announcements when filter params change
  useEffect(() => {
    accumulatedAnnouncementsRef.current = [];
    setAccumulatedAnnouncements([]);
    setListTotal(0);
    setListPage(1);
   
  }, [pinnedFilter, statusFilter, debouncedSearch]);

  // Accumulate announcements across pages
  useEffect(() => {
    if (!listQuery.data || listQuery.isFetching) return;
    const newItems = listQuery.data.data;
    if (listPage === 1) {
      accumulatedAnnouncementsRef.current = newItems;
    } else {
      const existingIds = new Set(accumulatedAnnouncementsRef.current.map((item) => item.id));
      const deduplicated = newItems.filter((item) => !existingIds.has(item.id));
      accumulatedAnnouncementsRef.current = [...accumulatedAnnouncementsRef.current, ...deduplicated];
    }
    setAccumulatedAnnouncements([...accumulatedAnnouncementsRef.current]);
    setListTotal(listQuery.data.total);
  }, [listQuery.data, listQuery.isFetching, listPage]);

  useEffect(() => {
    if (isCreating) return;
    if (!selectedId && rows.length > 0) {
      setSelectedId(rows[0]?.id ?? null);
      return;
    }
    if (selectedId && rows.length > 0 && !rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? null);
    }
    if (selectedId && rows.length === 0) {
      setSelectedId(null);
    }
  }, [isCreating, rows, selectedId]);

  useEffect(() => {
    if (isCreating) {
      setTitle("");
      setBodyJson(TIPTAP_DEFAULT_JSON);
      setPinned(false);
      setArchived(false);
      setDraftEnabled(false);
      setPublishAt("");
      setExpiresAt("");
      setScheduleEnabled(false);
    } else if (selected) {
      setTitle(selected.title);
      setBodyJson(selected.body_json);
      setPinned(selected.pinned);
      setArchived(selected.status === "archived");
      setDraftEnabled(selected.status === "draft");
      setPublishAt(toDateTimePickerValue(selected.publish_at));
      setExpiresAt(toDateTimePickerValue(selected.expires_at));
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
        expiresAt !== toDateTimePickerValue(selected.expires_at) ||
        scheduleEnabled !== (selected.status === "scheduled") ||
        draftEnabled !== (selected.status === "draft") ||
        archived !== (selected.status === "archived")
      );
    }
    return false;
  }, [archived, bodyJson, canEdit, draftEnabled, expiresAt, isCreating, pinned, publishAt, scheduleEnabled, selected, title]);

  useBeforeUnloadPrompt(isDirty);

  const handleCreateByStatus = useCallback(() => {
    isCreatingHandlers.open();
    setDraftAnnouncementId(null);
    setSelectedId(null);
  }, []);

  const handleSelectId = useCallback((id: string | null) => {
    if (isDirty) {
      modals.openConfirmModal({
        title: t("confirm.discardUnsaved.title"),
        children: t("confirm.discardUnsaved.description"),
        centered: true,
        confirmProps: { color: "red" },
        labels: {
          cancel: t("action.cancel"),
          confirm: t("common:action.delete"),
        },
        onConfirm: () => {
          if (id !== null) {
            isCreatingHandlers.close();
          }
          setSelectedId(id);
        },
      });
      return;
    }
    if (id !== null) {
      isCreatingHandlers.close();
    }
    setSelectedId(id);
  }, [isDirty, isCreatingHandlers, t]);

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

      if (draftAnnouncementId) {
        updateMutation.mutate({
          id: draftAnnouncementId,
          payload: {
            title,
            body_json: bodyJson,
            pinned,
            status,
            publish_at: status === "published" ? new Date().toISOString() : toIsoOrUndefined(publishAt),
            expires_at: toIsoOrUndefined(expiresAt),
          },
        });
        isCreatingHandlers.close();
        setSelectedId(draftAnnouncementId);
        setDraftAnnouncementId(null);
        return;
      }

      createMutation.mutate({
        title,
        body_json: bodyJson,
        pinned,
        status,
        publish_at: status === "published" ? new Date().toISOString() : toIsoOrUndefined(publishAt),
        expires_at: toIsoOrUndefined(expiresAt),
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
        expires_at: toIsoOrUndefined(expiresAt),
      },
      ifMatch: `"announcement-${selected.id}-${selected.updated_at}"`,
    });
  };

  const handleCloseEditor = () => {
    if (isCreating) {
      const orphanDraftId = draftAnnouncementId;
      isCreatingHandlers.close();
      setDraftAnnouncementId(null);
      if (orphanDraftId) {
        archiveMutation.mutate(orphanDraftId);
      }
      if (rows.length > 0) {
        setSelectedId(rows[0]?.id ?? null);
      }
      return;
    }
    if (!selected) return;
    setTitle(selected.title);
    setBodyJson(selected.body_json);
    setPinned(selected.pinned);
    setArchived(selected.status === "archived");
    setDraftEnabled(selected.status === "draft");
    setPublishAt(toDateTimePickerValue(selected.publish_at));
    setExpiresAt(toDateTimePickerValue(selected.expires_at));
    setScheduleEnabled(selected.status === "scheduled");
  };

  const handleDelete = () => {
    if (!selectedId) return;
    archiveMutation.mutate(selectedId);
  };

  const handleUploadAnnouncementImages = async (file: File) => {
    let announcementId = selectedId;

    if (isCreating || !announcementId) {
      if (draftAnnouncementId) {
        announcementId = draftAnnouncementId;
      } else {
        const created = await createAnnouncement({
          title: title.trim() || t("draftTitle"),
          body_json: bodyJson || TIPTAP_DEFAULT_JSON,
          pinned: false,
          status: "draft",
        });
        setDraftAnnouncementId(created.id);
        announcementId = created.id;
        await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      }
    }

    const uploaded = await uploadAnnouncementImages(announcementId, [file]);
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
    expiresAt,
    setExpiresAt,
    scheduleEnabled,
    setScheduleEnabled,
    announcementsLastSeenAt,
    listQuery,
    detailQuery,
    rows,
    selected,
    listHasMore,
    listLoadingMore: listQuery.isFetching && listPage > 1,
    onLoadMoreList: () => setListPage((p) => p + 1),
    isBusy: createMutation.isPending || updateMutation.isPending || archiveMutation.isPending,
    savePending: updateMutation.isPending,
    deletePending: archiveMutation.isPending,
    isDirty,
    resetFilters,
    handleCreateByStatus,
    handleFinish,
    handleCloseEditor,
    handleDelete,
    handleUploadAnnouncementImages,
  };
}
