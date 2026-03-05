import { hasRoleAtLeast, type Announcement, type PaginatedResponse } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Group, Loader } from "@mantine/core";
import { notifications } from "@mantine/notifications";

const message = {
  success: (text: string) => notifications.show({ color: "infini-success", message: text, autoClose: 3000 }),
  error: (text: string) => notifications.show({ color: "infini-danger", message: text, autoClose: 3000 }),
};
import { format, isValid, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  archiveAnnouncement,
  createAnnouncement,
  uploadAnnouncementImages,
  updateAnnouncement,
} from "../../api/mutations/announcements";
import {
  fetchAnnouncement,
  fetchAnnouncements,
} from "../../api/queries/announcements";
import { queryKeys } from "../../api/query-keys";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAppError } from "../../hooks/useAppError";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useAuthStore } from "../../stores/auth";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { TIPTAP_DEFAULT_JSON } from "../shared/TipTapEditor";
import { AnnouncementDetailCard } from "../feature/announcements/AnnouncementDetailCard";
import { AnnouncementFiltersCard } from "../feature/announcements/AnnouncementFiltersCard";
import { AnnouncementListCard } from "../feature/announcements/AnnouncementListCard";
import { CreateAnnouncementModal } from "../feature/announcements/CreateAnnouncementModal";
import "./AnnouncementsPage.css";

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
  return format(date, "yyyy-MM-dd HH:mm");
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

export function AnnouncementsPage() {
  const { t } = useTranslation("announcements");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const canEdit = isModerator && !isExternalView;
  const { showError } = useAppError();

  const [listScope, setListScope] = useState<"all" | "pinned" | "archived">("all");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [bodyJson, setBodyJson] = useState(TIPTAP_DEFAULT_JSON);
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [notifyDiscord, setNotifyDiscord] = useState(true);
  const [notifyWechat, setNotifyWechat] = useState(false);
  const [announcementsLastSeenAt, setAnnouncementsLastSeenAt] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: queryKeys.announcements.list(listScope, status ?? "all", search),
    queryFn: () =>
      fetchAnnouncements({
        page: 1,
        limit: 100,
        status,
        pinned: listScope === "pinned" ? true : undefined,
        search: search.trim() || undefined,
        archived: listScope === "archived",
      }),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.announcements.detail(selectedId),
    enabled: Boolean(selectedId),
    queryFn: () => fetchAnnouncement(selectedId as string),
  });

  const createMutation = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async () => {
      message.success(t("message.created"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
      setCreateModalOpen(false);
    },
    onError: (error) => {
      showError(error, t("message.createFailed"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      updateAnnouncement(id, payload),
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
          // If un-pinning while viewing "pinned" scope, remove the item from the list
          const shouldRemove = payload.pinned === false && listScope === "pinned";
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
        await queryClient.invalidateQueries({
          queryKey: queryKeys.announcements.detail(selectedId),
        });
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
    let raw = listQuery.data?.data ?? [];
    // Non-editors should only see published in normal tabs.
    if (!canEdit && listScope !== "archived") {
      raw = raw.filter((item) => item.status === "published");
    }
    if (listScope === "archived") {
      return raw;
    }
    return [...raw].sort((left, right) => {
      if (left.pinned === right.pinned) {
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      }
      return left.pinned ? -1 : 1;
    });
  }, [listQuery.data?.data, listScope, canEdit]);
  const selected = detailQuery.data ?? null;

  useEffect(() => {
    setAnnouncementsLastSeenAt(readAnnouncementsLastSeenAt());
  }, []);

  useEffect(() => {
    if (!selectedId && rows.length > 0) {
      setSelectedId(rows[0]?.id ?? null);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setTitle(selected.title);
    setBodyJson(selected.body_json);
    setPinned(selected.pinned);
    setArchived(selected.status === "archived");
    setPublishAt(toDateTimePickerValue(selected.publish_at));
    setExpiresAt(toDateTimePickerValue(selected.expires_at));
    setScheduleEnabled(selected.status === "scheduled");
    setNotifyDiscord(selected.status === "published");
    setNotifyWechat(false);
  }, [selected]);

  const isBusy = createMutation.isPending || updateMutation.isPending || archiveMutation.isPending;
  const emptyText = useMemo(
    () => (
      <EmptyState
        title={search.trim() || status || listScope !== "all" ? t("empty.filtered") : t("empty")}
        actions={
          <Group gap={8} wrap="wrap">
            <Button
              variant="default"
              onClick={() => {
                setSearch("");
                setStatus(undefined);
                setListScope("all");
              }}
              disabled={!search.trim() && !status && listScope === "all"}
            >
              {t("action.resetFilters")}
            </Button>
            {canEdit ? (
              <Button onClick={() => setCreateModalOpen(true)}>
                {t("action.createAnnouncement")}
              </Button>
            ) : null}
          </Group>
        }
      />
    ),
    [canEdit, listScope, search, status, t],
  );
  const isDirty = useMemo(() => {
    if (!canEdit) return false;
    if (selected) {
      return (
        title !== selected.title ||
        bodyJson !== selected.body_json ||
        pinned !== selected.pinned ||
        publishAt !== toDateTimePickerValue(selected.publish_at) ||
        expiresAt !== toDateTimePickerValue(selected.expires_at) ||
        scheduleEnabled !== (selected.status === "scheduled")
      );
    }
    return false;
  }, [bodyJson, canEdit, scheduleEnabled, expiresAt, pinned, publishAt, selected, title]);
  useBeforeUnloadPrompt(isDirty);

  const saveSelectedByStatus = (nextStatus?: Announcement["status"]) => {
    if (!selectedId) return;
    const status = archived ? "archived" : (nextStatus ?? "draft");
    updateMutation.mutate({
      id: selectedId,
      payload: {
        title,
        body_json: bodyJson,
        pinned,
        status,
        publish_at:
          status === "published"
            ? new Date().toISOString()
            : toIsoOrUndefined(publishAt),
        expires_at: toIsoOrUndefined(expiresAt),
        notify_discord: notifyDiscord,
        notify_wechat: notifyWechat,
      },
    });
  };

  const handlePublish = () => {
    if (scheduleEnabled && publishAt.trim()) {
      saveSelectedByStatus("scheduled");
    } else {
      saveSelectedByStatus("published");
    }
  };

  const handleUploadAnnouncementImages = async (file: File) => {
    if (!selectedId) {
      throw new Error("Save announcement first before uploading images");
    }
    const uploaded = await uploadAnnouncementImages(selectedId, [file]);
    const key = uploaded.keys[0];
    if (!key) {
      throw new Error("Image upload returned no key");
    }
    return key;
  };

  const handleCreateByStatus = useCallback((payload: {
    title: string;
    body_json: string;
    pinned: boolean;
    status: Announcement["status"];
    publish_at?: string;
    expires_at?: string;
    notify_discord: boolean;
    notify_wechat: boolean;
  }) => {
    createMutation.mutate(payload);
  }, [createMutation.mutate]);

  usePageHeaderActions(null);
  useLoadWarningToast(listQuery.isError || detailQuery.isError, t("common:loadErrorRetry"));

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} className="announcements-page">
      <AnnouncementFiltersCard
        listScope={listScope}
        status={status}
        search={search}
        canEdit={canEdit}
        onListScopeChange={setListScope}
        onStatusChange={setStatus}
        onSearchChange={setSearch}
        onCreate={() => setCreateModalOpen(true)}
      />

      <div className="announcements-grid">
        <AnnouncementListCard
          title={t("list.title")}
          rows={rows}
          selectedId={selectedId}
          canEdit={canEdit}
          announcementsLastSeenAt={announcementsLastSeenAt}
          isLoading={false}
          isError={false}
          warningMessage={t("common:loadError")}
          emptyText={emptyText}
          onSelect={setSelectedId}
        />

        <AnnouncementDetailCard
          title={t("detail.title")}
          canEdit={canEdit}
          selectedId={selectedId}
          selected={selected}
          isLoading={false}
          isError={false}
          warningMessage={t("common:loadError")}
          savePending={updateMutation.isPending}
          titleValue={title}
          onTitleChange={setTitle}
          bodyJson={bodyJson}
          onBodyJsonChange={setBodyJson}
          pinned={pinned}
          onPinnedChange={setPinned}
          scheduleEnabled={scheduleEnabled}
          onScheduleEnabledChange={setScheduleEnabled}
          notifyDiscord={notifyDiscord}
          onNotifyDiscordChange={setNotifyDiscord}
          notifyWechat={notifyWechat}
          onNotifyWechatChange={setNotifyWechat}
          publishAt={publishAt}
          onPublishAtChange={setPublishAt}
          expiresAt={expiresAt}
          onExpiresAtChange={setExpiresAt}
          onSaveDraft={() => saveSelectedByStatus("draft")}
          onPublish={handlePublish}
          archived={archived}
          onArchivedChange={setArchived}
          onImageUpload={handleUploadAnnouncementImages}
          isDirty={isDirty}
          emptyTitle={t("common:message.noData")}
        />
      </div>

      {/* Create Modal */}
      <CreateAnnouncementModal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreateByStatus={handleCreateByStatus}
        creating={createMutation.isPending}
      />

      {isBusy ? <Loader size="sm" /> : null}
    </PageLayout>
  );
}
