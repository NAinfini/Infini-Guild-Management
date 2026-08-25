import {
  ANNOUNCEMENT_ATTACHMENT_FILE_ACCEPT,
  type Announcement,
  type AnnouncementAttachment,
} from "@guild/shared";
import {
  ArchiveIcon,
  CalendarTimeIcon,
  ChevronDownIcon,
  FileTextIcon,
  NoteIcon,
  PencilIcon,
  PinIcon,
  SendIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "@portal/components/icons";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@portal/components/ui/avatar";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { Input } from "@portal/components/ui/input";
import { Separator } from "@portal/components/ui/separator";
import { Skeleton } from "@portal/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import { lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";
import { buildTipTapEditorLabels } from "../../shared/tiptap-meta";
import { EmptyState } from "../../shared/EmptyState";
import { NativeDateTimeInput } from "../../shared/NativeDateTimeInput";
import { AnnouncementAttachmentItem } from "./AnnouncementAttachmentItem";

const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((module) => ({ default: module.TipTapEditor })),
);

type StatusMode = "none" | "draft" | "archived" | "scheduled";

type AnnouncementDetailCardProps = {
  title: ReactNode;
  canEdit: boolean;
  selectedId: string | null;
  selected: Announcement | null;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  savePending: boolean;
  titleValue: string;
  onTitleChange: (value: string) => void;
  bodyJson: string;
  onBodyJsonChange: (value: string) => void;
  pinned: boolean;
  onPinnedChange: (value: boolean) => void;
  scheduleEnabled: boolean;
  onScheduleEnabledChange: (value: boolean) => void;
  publishAt: string;
  onPublishAtChange: (value: string) => void;
  onFinish: (mode: StatusMode) => void;
  onDelete: () => void;
  onCloseEditor: () => void;
  deletePending: boolean;
  draftEnabled: boolean;
  onDraftEnabledChange: (value: boolean) => void;
  archived: boolean;
  onArchivedChange: (value: boolean) => void;
  onImageUpload: (file: File) => Promise<string>;
  attachments: AnnouncementAttachment[];
  attachmentUploading: boolean;
  attachmentMaxBytes: number;
  attachmentQuota: number;
  onAttachmentUpload: (file: File) => Promise<void>;
  onAttachmentRemove: (mediaId: string) => void;
  isDirty: boolean;
  isPublishReady: boolean;
  emptyTitle: ReactNode;
};

function EditorSkeleton() {
  return (
    <div className="announcement-editor-skeleton" aria-busy="true">
      <Skeleton className="announcement-editor-skeleton__line announcement-editor-skeleton__line--heading" />
      <Skeleton className="announcement-editor-skeleton__line" />
      <Skeleton className="announcement-editor-skeleton__line" />
      <Skeleton className="announcement-editor-skeleton__line announcement-editor-skeleton__line--short" />
    </div>
  );
}

export function AnnouncementDetailCard({
  title,
  canEdit,
  selectedId,
  selected,
  isLoading,
  isError,
  warningMessage,
  savePending,
  titleValue,
  onTitleChange,
  bodyJson,
  onBodyJsonChange,
  pinned,
  onPinnedChange,
  onScheduleEnabledChange,
  publishAt,
  onPublishAtChange,
  onFinish,
  onDelete,
  onCloseEditor,
  deletePending,
  onDraftEnabledChange,
  archived,
  onArchivedChange,
  onImageUpload,
  attachments,
  attachmentUploading,
  attachmentMaxBytes,
  attachmentQuota,
  onAttachmentUpload,
  onAttachmentRemove,
  isDirty,
  isPublishReady,
  emptyTitle,
}: AnnouncementDetailCardProps) {
  const { t } = useTranslation("announcements");
  const { t: translateEditor } = useTranslation("editor");
  const confirm = useConfirmDialog();
  const editorLabels = useMemo(() => buildTipTapEditorLabels(translateEditor), [translateEditor]);
  const isCreateMode = selectedId === "new" && !selected;
  const [editing, setEditing] = useState(isCreateMode);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditing(isCreateMode);
  }, [isCreateMode]);

  const validateAndFinish = (mode: StatusMode) => {
    if (!isPublishReady) return;

    if (mode === "scheduled" && publishAt) {
      const scheduledDate = new Date(publishAt);
      if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate <= new Date()) {
        notifyError(t("validation.schedulePast"));
        return;
      }
    }

    onDraftEnabledChange(mode === "draft");
    onScheduleEnabledChange(mode === "scheduled");
    onArchivedChange(mode === "archived");
    onFinish(mode);
    setEditing(false);
  };

  const handleDeleteConfirm = async () => {
    const confirmed = await confirm({
      title: t("modal.deleteAnnouncement"),
      description: t("confirm.delete"),
      confirmLabel: t("action.delete"),
      cancelLabel: t("action.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      onDelete();
      setEditing(false);
    }
  };

  const handleCloseEditor = () => {
    setEditing(false);
    onCloseEditor();
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void onAttachmentUpload(file).finally(() => {
      input.value = "";
    });
  };

  const isReader = !editing && selected !== null;
  const canShowEditorActions = canEdit && (selected !== null || isCreateMode);

  return (
    <Card className="announcements-detail-card">
      <div className="announcements-detail-card__content announcements-card-scroll">
        <header
          className={`announcements-detail-card__header ${isReader ? "announcement-reader-header" : ""}`.trim()}
        >
          {isReader ? (
            <div className="announcement-reader-heading">
              <div className="announcement-reader-title-row">
                {selected.pinned ? (
                  <Badge variant="outline" className="announcement-important-badge">
                    {t("status.important")}
                  </Badge>
                ) : null}
                <h2 className="announcement-reader-title">{selected.title}</h2>
              </div>
              <div className="announcement-reader-author-row">
                <Avatar size="lg">
                  {selected.author.avatar_media_id ? (
                    <AvatarImage src={resolveMediaUrl(selected.author.avatar_media_id)} alt="" />
                  ) : null}
                  <AvatarFallback>{selected.author.display_name.trim().charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="announcement-reader-author-copy">
                  <strong>{selected.author.display_name}</strong>
                  <div className="announcement-reader-meta-row">
                    <span className="announcement-reader-publish-time">
                      {t(selected.status === "scheduled"
                        ? "meta.scheduled"
                        : selected.status === "draft"
                          ? "meta.created"
                          : "meta.published", {
                        datetime: formatDateTimeWithTimeZone(selected.publish_at ?? selected.created_at),
                      })}
                    </span>
                    {canEdit && selected.status === "scheduled" && selected.publish_at ? (
                      <Badge variant="outline" className="announcement-status-badge announcement-status-badge--scheduled">
                        {t("status.scheduled")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <h2 className="announcements-detail-card__title">{title}</h2>
          )}

          {canShowEditorActions ? (
            editing ? (
              <div className="announcement-editor-header-actions">
                {!isPublishReady ? (
                  <Badge variant="outline" className="announcement-save-state announcement-save-state--idle">
                    {t("status.notReady")}
                  </Badge>
                ) : isDirty ? (
                  <Badge variant="outline" className="announcement-save-state announcement-save-state--dirty">
                    {t("status.unsaved")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="announcement-save-state announcement-save-state--saved">
                    {t("status.saved")}
                  </Badge>
                )}
                <div className="announcement-publish-actions">
                  <Button
                    type="button"
                    size="sm"
                    disabled={savePending || !isPublishReady}
                    aria-busy={savePending || undefined}
                    onClick={() => validateAndFinish("none")}
                  >
                    <SendIcon size={14} aria-hidden="true" />
                    {t("action.publish")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={(
                        <Button
                          type="button"
                          size="icon-sm"
                          disabled={savePending || !isPublishReady}
                          aria-label={`${t("action.saveAsDraft")} / ${t("action.postScheduled")}`}
                        />
                      )}
                    >
                      <ChevronDownIcon size={14} aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="announcement-publish-menu">
                      <DropdownMenuItem onClick={() => validateAndFinish("draft")}>
                        <NoteIcon size={16} aria-hidden="true" />
                        {t("action.saveAsDraft")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => validateAndFinish("scheduled")}>
                        <CalendarTimeIcon size={16} aria-hidden="true" />
                        {t("action.postScheduled")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleCloseEditor}>
                  <XIcon size={14} aria-hidden="true" />
                  {t("action.cancel")}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilIcon size={14} aria-hidden="true" />
                {t("action.edit")}
              </Button>
            )
          ) : null}
        </header>

        {isLoading ? <EditorSkeleton /> : null}
        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>{warningMessage}</AlertTitle>
          </Alert>
        ) : null}

        {!isLoading && !isError && selected && !editing ? (
          <div className="announcement-reader-content">
            <Separator />
            <Suspense fallback={<EditorSkeleton />}>
              <LazyTipTapEditor
                value={bodyJson}
                onChange={() => {}}
                placeholder=""
                editable={false}
                onImageUpload={onImageUpload}
                labels={editorLabels}
              />
            </Suspense>

            {selected.attachments.length > 0 ? (
              <section className="announcement-attachments-section" aria-labelledby="announcement-attachments-title">
                <Separator />
                <div className="announcement-attachments-heading">
                  <FileTextIcon size={18} aria-hidden="true" />
                  <h3 id="announcement-attachments-title" className="announcement-attachments-title">
                    {t("section.attachments")}
                  </h3>
                  <Badge variant="secondary">{selected.attachments.length}</Badge>
                </div>
                <div className="announcement-attachments-grid">
                  {selected.attachments.map((attachment) => (
                    <AnnouncementAttachmentItem
                      key={attachment.media_id}
                      attachment={attachment}
                      downloadLabel={t("action.downloadAttachment", { name: attachment.name })}
                      removeLabel=""
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <p className="announcement-reader-updated">
              {t("meta.updated", { datetime: formatDateTimeWithTimeZone(selected.updated_at) })}
            </p>
          </div>
        ) : null}

        {!isLoading && !isError && (selected || isCreateMode) && editing ? (
          <div className="announcement-editor-layout">
            <div className="announcement-editor-main">
              <Input
                value={titleValue}
                onChange={(event) => onTitleChange(event.currentTarget.value)}
                placeholder={t("field.title")}
                aria-label={t("aria.title")}
                className="announcement-editor-title-input"
              />
              <Suspense fallback={<EditorSkeleton />}>
                <LazyTipTapEditor
                  value={bodyJson}
                  onChange={onBodyJsonChange}
                  placeholder={t("field.body")}
                  ariaLabel={t("field.body")}
                  editable
                  onImageUpload={onImageUpload}
                  labels={editorLabels}
                />
              </Suspense>

              <section
                className="announcement-editor-attachments"
                aria-labelledby="announcement-editor-attachments-title"
              >
                <div className="announcement-editor-attachments__header">
                  <div>
                    <div className="announcement-attachments-heading">
                      <h3 id="announcement-editor-attachments-title" className="announcement-attachments-title">
                        {t("section.attachments")}
                      </h3>
                      {attachments.length > 0 ? <Badge variant="secondary">{attachments.length}</Badge> : null}
                    </div>
                    <p className="announcement-attachment-help">
                      {t("attachment.help", {
                        count: attachmentQuota,
                        size: Math.floor(attachmentMaxBytes / 1024 / 1024),
                      })}
                    </p>
                  </div>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    accept={ANNOUNCEMENT_ATTACHMENT_FILE_ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={handleAttachmentChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={attachmentUploading}
                    aria-busy={attachmentUploading || undefined}
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    <UploadIcon size={16} aria-hidden="true" />
                    {t("action.addAttachment")}
                  </Button>
                </div>
                {attachments.length > 0 ? (
                  <div className="announcement-attachments-grid announcement-attachments-grid--editor">
                    {attachments.map((attachment) => (
                      <AnnouncementAttachmentItem
                        key={attachment.media_id}
                        attachment={attachment}
                        removeLabel={t("action.removeAttachment", { name: attachment.name })}
                        downloadLabel=""
                        onRemove={onAttachmentRemove}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="announcement-attachments-empty">{t("attachment.empty")}</p>
                )}
              </section>
            </div>

            <aside className="announcement-editor-sidebar" aria-label={t("detail.title")}>
              <div className="announcement-editor-icon-actions">
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        variant={pinned ? "secondary" : "outline"}
                        size="icon"
                        aria-pressed={pinned}
                        aria-label={pinned ? t("action.unpin") : t("action.pin")}
                        onClick={() => onPinnedChange(!pinned)}
                      />
                    )}
                  >
                    <PinIcon size={16} aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>{pinned ? t("action.unpin") : t("action.pin")}</TooltipContent>
                </Tooltip>
                {!isCreateMode ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <Button
                          type="button"
                          variant={archived ? "secondary" : "outline"}
                          size="icon"
                          aria-pressed={archived}
                          aria-label={t("action.archive")}
                          onClick={() => onArchivedChange(!archived)}
                        />
                      )}
                    >
                      <ArchiveIcon size={16} aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>{t("action.archive")}</TooltipContent>
                  </Tooltip>
                ) : null}
                {!isCreateMode ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label={t("action.delete")}
                    disabled={deletePending}
                    aria-busy={deletePending || undefined}
                    onClick={() => void handleDeleteConfirm()}
                  >
                    <TrashIcon size={16} aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              <Separator />

              <div className="announcement-editor-schedule">
                <span className="announcement-editor-field-label">{t("field.publishAt")}</span>
                <NativeDateTimeInput
                  type="datetime-local"
                  value={publishAt || undefined}
                  onChange={(event) => onPublishAtChange(event.currentTarget.value)}
                  aria-label={t("aria.publishTime")}
                  size="sm"
                />
              </div>

              {selected ? (
                <>
                  <Separator />
                  <p className="announcement-editor-updated">
                    {t("meta.updated", { datetime: formatDateTimeWithTimeZone(selected.updated_at) })}
                  </p>
                </>
              ) : null}
            </aside>
          </div>
        ) : null}

        {!isLoading && !isError && !selected && selectedId !== "new" ? <EmptyState title={emptyTitle} /> : null}
      </div>
    </Card>
  );
}
