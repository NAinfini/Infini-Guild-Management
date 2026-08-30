import type {
  ImportantNotice,
} from "@guild/shared";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createAdminImportantNotice,
  deleteAdminImportantNotice,
  publishAdminImportantNotice,
  updateAdminImportantNotice,
  withdrawAdminImportantNotice,
  fetchAdminImportantNotices,
} from "@portal/services/NotificationService";
import { queryKeys } from "@portal/api/query-keys";
import { EyeIcon, PencilIcon, PlusIcon, SendIcon, TrashIcon } from "@portal/components/icons";
import { EmptyState } from "@portal/components/shared/EmptyState";
import { TipTapEditor } from "@portal/components/shared/TipTapEditor";
import { TIPTAP_DEFAULT_JSON, buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useAppError } from "@portal/hooks/useAppError";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { formatDateTime, fromDateTimeLocalValue, toDateTimeLocalValue } from "@portal/utils/datetime";
import { notifySuccess } from "@portal/utils/notifications";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AdminImportantNoticeDeliveryFields,
  type NoticeDraft,
} from "./AdminImportantNoticeDeliveryFields";
import "./AdminImportantNoticesSection.css";

function blankDraft(): NoticeDraft {
  return {
    id: null,
    revisionToken: null,
    title: "",
    bodyJson: TIPTAP_DEFAULT_JSON,
    publishAt: "",
    expiresAt: "",
    requiresAcknowledgement: false,
    audienceScope: "all",
    audienceRoleIds: [],
  };
}

export function draftFromNotice(notice: ImportantNotice): NoticeDraft {
  const expiresAt = notice.expires_at && Date.parse(notice.expires_at) > Date.now()
    ? toDateTimeLocalValue(notice.expires_at)
    : "";
  return {
    id: notice.id,
    revisionToken: notice.revision_token,
    title: notice.title,
    bodyJson: notice.body_json,
    // A withdrawn notice is being prepared for a new publication. Its prior
    // instant cannot be sent back as a schedule, because that time has passed.
    publishAt: notice.status === "withdrawn" ? "" : toDateTimeLocalValue(notice.publish_at),
    expiresAt,
    requiresAcknowledgement: notice.requires_acknowledgement,
    audienceScope: notice.audience_scope,
    audienceRoleIds: [...notice.audience_role_ids].sort(),
  };
}

function statusVariant(status: ImportantNotice["status"]): "default" | "secondary" | "outline" {
  switch (status) {
    case "published": return "default";
    case "scheduled": return "secondary";
    case "withdrawn": return "outline";
    case "draft": return "secondary";
  }
}

function replaceNoticeInCache(
  current: ImportantNotice[] | undefined,
  next: ImportantNotice,
): ImportantNotice[] {
  const index = current?.findIndex((notice) => notice.id === next.id) ?? -1;
  if (index < 0) return [next, ...(current ?? [])];
  return current?.map((notice) => notice.id === next.id ? next : notice) ?? [next];
}

export function AdminImportantNoticesSection() {
  const { t } = useTranslation("admin");
  const { t: common } = useTranslation("common");
  const { t: editor } = useTranslation("editor");
  const { showError } = useAppError();
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NoticeDraft>(blankDraft);
  const [previewOpen, setPreviewOpen] = useState(false);
  const titleInputId = useId();
  const editorLabels = useMemo(() => buildTipTapEditorLabels(editor), [editor]);

  const noticesQuery = useQuery({
    queryKey: queryKeys.importantNotices.admin(),
    queryFn: fetchAdminImportantNotices,
    staleTime: 30_000,
  });
  const notices = noticesQuery.data ?? [];
  const noticesBlockingError = noticesQuery.isError && noticesQuery.data === undefined;
  const noticesRefreshError = noticesQuery.isError && noticesQuery.data !== undefined;
  const selected = notices.find((notice) => notice.id === selectedId) ?? null;
  const selectedDraft = useMemo(() => selected ? draftFromNotice(selected) : null, [selected]);
  const isPublished = !creating && selected?.status === "published";
  const editable = !isPublished;
  const publishAt = fromDateTimeLocalValue(draft.publishAt);
  const expiresAt = fromDateTimeLocalValue(draft.expiresAt);
  const expiryIsPast = Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
  const expiryPrecedesPublication = Boolean(publishAt && expiresAt && Date.parse(expiresAt) <= Date.parse(publishAt));
  const hasInvalidDate = (draft.publishAt.length > 0 && !publishAt)
    || (draft.expiresAt.length > 0 && !expiresAt)
    || expiryIsPast
    || expiryPrecedesPublication;
  const hasValidAudience = draft.audienceScope === "all" || draft.audienceRoleIds.length > 0;
  const canSave = editable && draft.title.trim().length > 0 && !hasInvalidDate && hasValidAudience;
  const isDirty = Boolean(selectedDraft && !creating && (
    draft.title !== selectedDraft.title
    || draft.bodyJson !== selectedDraft.bodyJson
    || draft.publishAt !== selectedDraft.publishAt
    || draft.expiresAt !== selectedDraft.expiresAt
    || draft.requiresAcknowledgement !== selectedDraft.requiresAcknowledgement
    || draft.audienceScope !== selectedDraft.audienceScope
    || draft.audienceRoleIds.join("\u0000") !== selectedDraft.audienceRoleIds.join("\u0000")
  ));

  useEffect(() => {
    if (!selectedDraft || creating) return;
    if (draft.id === selectedDraft.id) return;
    setDraft(selectedDraft);
  }, [creating, draft.id, selectedDraft]);

  useEffect(() => {
    const firstNotice = notices[0];
    if (creating || !noticesQuery.isSuccess || !firstNotice) return;
    if (selected && selectedId) return;
    setSelectedId(firstNotice.id);
  }, [creating, notices, noticesQuery.isSuccess, selected, selectedId]);

  const invalidateNotices = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.importantNotices.all });
  };

  const saveMutation = useMutation({
    mutationFn: async (next: NoticeDraft) => {
      if (next.id) {
        if (!next.revisionToken) throw new TypeError("Important notice draft is missing its revision token");
        return updateAdminImportantNotice(next.id, {
          expected_revision_token: next.revisionToken,
          title: next.title.trim(),
          body_json: next.bodyJson,
          publish_at: next.publishAt ? fromDateTimeLocalValue(next.publishAt) ?? null : null,
          expires_at: next.expiresAt ? fromDateTimeLocalValue(next.expiresAt) ?? null : null,
          requires_acknowledgement: next.requiresAcknowledgement,
          audience_scope: next.audienceScope,
          audience_role_ids: next.audienceRoleIds,
        });
      }
      return createAdminImportantNotice({
        title: next.title.trim(),
        body_json: next.bodyJson,
        status: next.publishAt ? "scheduled" : "draft",
        publish_at: next.publishAt ? fromDateTimeLocalValue(next.publishAt) : undefined,
        expires_at: next.expiresAt ? fromDateTimeLocalValue(next.expiresAt) : undefined,
        requires_acknowledgement: next.requiresAcknowledgement,
        audience_scope: next.audienceScope,
        audience_role_ids: next.audienceRoleIds,
      });
    },
    onSuccess: async (notice) => {
      queryClient.setQueryData<ImportantNotice[]>(queryKeys.importantNotices.admin(), (current) =>
        replaceNoticeInCache(current, notice));
      setCreating(false);
      setSelectedId(notice.id);
      setDraft(draftFromNotice(notice));
      notifySuccess(t("importantNotices.message.saved"));
      await invalidateNotices();
    },
    onError: (error) => showError(error, t("importantNotices.message.saveFailed")),
  });

  const lifecycleMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "publish" | "withdraw" }) => (
      action === "publish" ? publishAdminImportantNotice(id) : withdrawAdminImportantNotice(id)
    ),
    onSuccess: async (notice, variables) => {
      queryClient.setQueryData<ImportantNotice[]>(queryKeys.importantNotices.admin(), (current) =>
        replaceNoticeInCache(current, notice));
      setDraft(draftFromNotice(notice));
      notifySuccess(t(variables.action === "publish"
        ? "importantNotices.message.published"
        : "importantNotices.message.withdrawn"));
      await invalidateNotices();
    },
    onError: (error) => showError(error, t("importantNotices.message.lifecycleFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAdminImportantNotice,
    onSuccess: async (_result, id) => {
      queryClient.setQueryData<ImportantNotice[]>(queryKeys.importantNotices.admin(), (current) =>
        (current ?? []).filter((notice) => notice.id !== id));
      setSelectedId(null);
      setCreating(false);
      setDraft(blankDraft());
      notifySuccess(t("importantNotices.message.deleted"));
      await invalidateNotices();
    },
    onError: (error) => showError(error, t("importantNotices.message.deleteFailed")),
  });

  const startCreate = () => {
    setSelectedId(null);
    setCreating(true);
    setDraft(blankDraft());
  };

  const selectNotice = (notice: ImportantNotice) => {
    setCreating(false);
    setSelectedId(notice.id);
    setDraft(draftFromNotice(notice));
  };

  const removeSelected = async () => {
    if (!selected || selected.status === "published") return;
    const accepted = await confirm({
      title: t("importantNotices.confirmDelete.title"),
      description: t("importantNotices.confirmDelete.description", { title: selected.title }),
      confirmLabel: t("importantNotices.action.delete"),
      cancelLabel: common("action.cancel"),
      intent: "danger",
    });
    if (accepted) deleteMutation.mutate(selected.id);
  };

  const previewTitle = draft.title.trim() || t("importantNotices.untitled");
  if (noticesQuery.data !== undefined && notices.length === 0 && !creating) {
    return (
      <div className="admin-panel important-notices-admin important-notices-admin--empty">
        {noticesRefreshError ? (
          <Alert variant="destructive">
            <AlertTitle>{common("loadError")}</AlertTitle>
            <AlertDescription>
              <span>{common("loadErrorRetry")}</span>
              <Button size="sm" variant="outline" loading={noticesQuery.isFetching} onClick={() => void noticesQuery.refetch()}>
                {common("action.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <EmptyState
          title={t("importantNotices.empty.title")}
          description={t("importantNotices.empty.description")}
          actions={<Button onClick={startCreate}>{t("importantNotices.action.create")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="admin-panel important-notices-admin">
      <div className="important-notices-admin__master">
        <div className="important-notices-admin__master-head">
          <div className="important-notices-admin__header-row">
            <div className="important-notices-admin__heading">
              <strong>{t("importantNotices.title")}</strong>
              <span>{t("importantNotices.description")}</span>
            </div>
            <Tooltip>
              <TooltipTrigger render={<Button
                type="button"
                size="icon-sm"
                aria-label={t("importantNotices.action.create")}
                onClick={startCreate}
              />}>
                <PlusIcon size={15} />
              </TooltipTrigger>
              <TooltipContent>{t("importantNotices.action.create")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <ScrollArea className="important-notices-admin__list">
          <div className="important-notices-admin__list-content">
            {noticesRefreshError ? (
              <Alert variant="destructive">
                <AlertTitle>{common("loadError")}</AlertTitle>
                <AlertDescription>
                  <span>{common("loadErrorRetry")}</span>
                  <Button size="sm" variant="outline" loading={noticesQuery.isFetching} onClick={() => void noticesQuery.refetch()}>
                    {common("action.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {noticesQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton className="important-notices-admin__notice-skeleton" key={index} />
              ))
            ) : noticesBlockingError ? (
              <EmptyState
                status="error"
                title={common("loadError")}
                actions={(
                  <Button size="xs" variant="outline" onClick={() => void noticesQuery.refetch()}>
                    {common("action.retry")}
                  </Button>
                )}
              />
            ) : notices.map((notice) => (
              <button
                type="button"
                key={notice.id}
                className={`important-notices-admin__notice${notice.id === selectedId && !creating ? " important-notices-admin__notice--active" : ""}`}
                onClick={() => selectNotice(notice)}
              >
                <span className="important-notices-admin__notice-main">
                  <strong>{notice.title}</strong>
                  <span>{formatDateTime(notice.updated_at)}</span>
                </span>
                <Badge variant={statusVariant(notice.status)} data-status={notice.status}>
                  {t(`importantNotices.status.${notice.status}`)}
                </Badge>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="important-notices-admin__detail">
        {creating || selected ? (
          <>
            <div className="important-notices-admin__detail-head">
              <div className="important-notices-admin__header-row">
                <div className="important-notices-admin__heading">
                  <div className="important-notices-admin__title-row">
                    <strong className="important-notices-admin__detail-title">
                      {creating ? t("importantNotices.createTitle") : selected?.title}
                    </strong>
                    {selected ? (
                      <Badge variant={statusVariant(selected.status)} data-status={selected.status}>
                        {t(`importantNotices.status.${selected.status}`)}
                      </Badge>
                    ) : null}
                  </div>
                  {isPublished ? <span>{t("importantNotices.publishedLocked")}</span> : null}
                </div>
                <div className="important-notices-admin__icon-actions">
                  <Tooltip>
                    <TooltipTrigger render={<Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("importantNotices.action.preview")}
                      onClick={() => setPreviewOpen(true)}
                    />}>
                      <EyeIcon size={16} />
                    </TooltipTrigger>
                    <TooltipContent>{t("importantNotices.action.preview")}</TooltipContent>
                  </Tooltip>
                  {selected && !isPublished ? (
                    <Tooltip>
                      <TooltipTrigger render={<Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        aria-label={t("importantNotices.action.delete")}
                        onClick={() => void removeSelected()}
                        loading={deleteMutation.isPending}
                      />}>
                        <TrashIcon size={16} />
                      </TooltipTrigger>
                      <TooltipContent>{t("importantNotices.action.delete")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </div>

            <ScrollArea className="important-notices-admin__detail-body">
              <div className="important-notices-admin__editor-grid">
                <div className="important-notices-admin__editor-main">
                  <div className="important-notices-admin__field">
                    <Label htmlFor={titleInputId}>{t("importantNotices.field.title")}</Label>
                    <Input
                      id={titleInputId}
                      value={draft.title}
                      maxLength={200}
                      disabled={!editable}
                      required
                      onChange={(event) => {
                        const title = event.currentTarget.value;
                        setDraft((current) => ({ ...current, title }));
                      }}
                    />
                  </div>
                  <div className="important-notices-admin__field">
                    <Label>{t("importantNotices.field.body")}</Label>
                    <TipTapEditor
                      value={draft.bodyJson}
                      onChange={(bodyJson) => setDraft((current) => ({ ...current, bodyJson }))}
                      editable={editable}
                      placeholder={t("importantNotices.placeholder.body")}
                      labels={editorLabels}
                      ariaLabel={t("importantNotices.field.body")}
                    />
                  </div>
                </div>
                <AdminImportantNoticeDeliveryFields
                  draft={draft}
                  editable={editable}
                  hasValidAudience={hasValidAudience}
                  expiryError={expiryIsPast || expiryPrecedesPublication
                    ? t("importantNotices.validation.expiry")
                    : undefined}
                  setDraft={setDraft}
                />
              </div>
            </ScrollArea>

            <div className="important-notices-admin__detail-foot">
              {isPublished ? (
                <Button
                  variant="outline"
                  className="important-notices-admin__withdraw"
                  loading={lifecycleMutation.isPending}
                  onClick={() => selected && lifecycleMutation.mutate({ id: selected.id, action: "withdraw" })}
                >
                  {t("importantNotices.action.withdraw")}
                </Button>
              ) : (
                <div className="important-notices-admin__footer-actions">
                  {creating || isDirty ? (
                    <span className="important-notices-admin__unsaved">
                      {t("importantNotices.unsavedBeforePublish")}
                    </span>
                  ) : null}
                  <Button
                    variant="outline"
                    loading={saveMutation.isPending}
                    disabled={!canSave}
                    onClick={() => saveMutation.mutate(draft)}
                  >
                    <PencilIcon size={16} data-icon="inline-start" />
                    {t("importantNotices.action.save")}
                  </Button>
                  {selected?.status === "scheduled" ? (
                    <Button
                      variant="outline"
                      className="important-notices-admin__withdraw"
                      loading={lifecycleMutation.isPending}
                      disabled={isDirty}
                      onClick={() => lifecycleMutation.mutate({ id: selected.id, action: "withdraw" })}
                    >
                      {t("importantNotices.action.withdraw")}
                    </Button>
                  ) : null}
                  <Button
                    loading={lifecycleMutation.isPending}
                    disabled={!selected || isDirty}
                    onClick={() => selected && lifecycleMutation.mutate({ id: selected.id, action: "publish" })}
                  >
                    <SendIcon size={16} data-icon="inline-start" />
                    {t("importantNotices.action.publish")}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="important-notices-admin__preview" closeLabel={common("action.close")}>
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("importantNotices.action.preview")}
            </DialogDescription>
          </DialogHeader>
          <TipTapEditor
            value={draft.bodyJson}
            onChange={() => undefined}
            editable={false}
            placeholder=""
            labels={editorLabels}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
