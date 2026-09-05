import { ANNOUNCEMENT_CATEGORIES, type Announcement, type AnnouncementAttachment } from "@guild/shared";
import type { AnnouncementCategory } from "@guild/shared/constants/announcements";
import {
  FileTextIcon,
  PinIcon,
  TrashIcon,
} from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Separator } from "@portal/components/ui/separator";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { Switch } from "@portal/components/ui/switch";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import { lazy, Suspense, type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";
import { buildTipTapEditorLabels } from "../../shared/tiptap-meta";
import { ContentDetailHeader } from "../../shared/ContentDetailHeader";
import { EmptyState } from "../../shared/EmptyState";
import { NativeDateTimeInput } from "../../shared/NativeDateTimeInput";
import { AnnouncementAttachmentItem } from "./AnnouncementAttachmentItem";
import { AnnouncementEditorAttachments } from "./AnnouncementEditorAttachments";
import { AnnouncementDetailHeaderActions } from "./AnnouncementDetailHeaderActions";

const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((module) => ({ default: module.TipTapEditor })),
);

type StatusMode = "none" | "draft" | "archived" | "scheduled";

type AnnouncementDetailCardProps = {
  navigation: ReactNode;
  title: ReactNode;
  canEdit: boolean;
  canCreate: boolean;
  canArchive: boolean;
  canDelete: boolean;
  selectedId: string | null;
  selected: Announcement | null;
  isLoading: boolean;
  savePending: boolean;
  titleValue: string;
  onTitleChange: (value: string) => void;
  category: AnnouncementCategory;
  onCategoryChange: (value: AnnouncementCategory) => void;
  bodyJson: string;
  onBodyJsonChange: (value: string) => void;
  pinned: boolean;
  onPinnedChange: (value: boolean) => void;
  publishAt: string;
  onPublishAtChange: (value: string) => void;
  onStartEditing: () => void;
  onFinish: (mode: StatusMode) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onCloseEditor: () => void;
  archivePending: boolean;
  deletePending: boolean;
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

export function AnnouncementDetailCard({
  navigation,
  title,
  canEdit,
  canCreate,
  canArchive,
  canDelete,
  selectedId,
  selected,
  isLoading,
  savePending,
  titleValue,
  onTitleChange,
  category,
  onCategoryChange,
  bodyJson,
  onBodyJsonChange,
  pinned,
  onPinnedChange,
  publishAt,
  onPublishAtChange,
  onStartEditing,
  onFinish,
  onDelete,
  onCloseEditor,
  archivePending,
  deletePending,
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
  const [archiveToggleChecked, setArchiveToggleChecked] = useState(false);

  useEffect(() => {
    setEditing(isCreateMode);
    setArchiveToggleChecked(false);
  }, [isCreateMode, selectedId]);

  const validateAndFinish = async (mode: Exclude<StatusMode, "archived">) => {
    if (!isPublishReady || attachmentUploading) return;

    if (mode === "scheduled" && publishAt) {
      const scheduledDate = new Date(publishAt);
      if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate <= new Date()) {
        notifyError(t("validation.schedulePast"));
        return;
      }
    }

    if (await onFinish(mode)) setEditing(false);
  };

  const handleArchiveConfirm = async (): Promise<boolean> => {
    const confirmed = await confirm({
      title: t("modal.archiveAnnouncement"),
      description: t("confirm.archive"),
      confirmLabel: t("action.archive"),
      cancelLabel: t("action.cancel"),
      intent: "danger",
    });
    if (!confirmed) return false;
    const archived = await onFinish("archived");
    if (archived) setEditing(false);
    return archived;
  };

  const handleArchiveToggle = async (checked: boolean) => {
    if (!checked) {
      setArchiveToggleChecked(false);
      return;
    }
    setArchiveToggleChecked(true);
    if (!await handleArchiveConfirm()) setArchiveToggleChecked(false);
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
      if (await onDelete()) setEditing(false);
    }
  };

  const handleCloseEditor = () => {
    setEditing(false);
    onCloseEditor();
  };

  const handleStartEditing = () => {
    onStartEditing();
    setEditing(true);
  };

  const isReader = !editing && selected !== null;
  const canUseEditor = isCreateMode ? canCreate : canEdit;
  const canShowEditorActions = canUseEditor && (selected !== null || isCreateMode);
  const headerActions = (
    <AnnouncementDetailHeaderActions
      isReader={isReader}
      selectedStatus={selected?.status}
      canEdit={canEdit}
      canArchive={canArchive}
      canDelete={canDelete}
      canShowEditorActions={canShowEditorActions}
      editing={editing}
      isPublishReady={isPublishReady}
      isDirty={isDirty}
      savePending={savePending}
      attachmentUploading={attachmentUploading}
      archivePending={archivePending}
      deletePending={deletePending}
      onStartEditing={handleStartEditing}
      onPublish={(mode) => { void validateAndFinish(mode); }}
      onArchive={() => { void handleArchiveConfirm(); }}
      onDelete={() => { void handleDeleteConfirm(); }}
      onCancelEditing={handleCloseEditor}
    />
  );

  return (
    <Card className="announcements-detail-card">
      <div className={`announcements-detail-card__content announcements-card-scroll${isReader ? " announcements-detail-card__content--reader" : ""}`}>
        {!isReader ? <div className="announcements-detail-navigation">{navigation}</div> : null}

        {isReader ? (
          <ContentDetailHeader
            domain="announce"
            navigation={navigation}
            category={t(`category.${selected.category}`)}
            states={selected.pinned ? (
              <Badge variant="outline" className="content-detail-header__state">
                <PinIcon size={13} aria-hidden="true" />
                {t("status.pinned")}
              </Badge>
            ) : undefined}
            title={selected.title}
            titleClassName="announcement-reader-title"
            authorLabel={t("meta.author")}
            authorName={selected.author.display_name}
            authorAvatarUrl={selected.author.avatar_media_id
              ? resolveMediaUrl(selected.author.avatar_media_id)
              : null}
            timestampLabel={t("meta.releaseTimeLabel")}
            timestamp={formatDateTimeWithTimeZone(selected.publish_at ?? selected.created_at)}
            timestampDateTime={selected.publish_at ?? selected.created_at}
            viewsLabel={t("meta.viewsLabel")}
            viewCount={selected.view_count}
            actions={headerActions}
          />
        ) : (
          <header className="announcements-detail-card__header">
            <h2 className="announcements-detail-card__title">{title}</h2>
            {headerActions}
          </header>
        )}

        {isLoading ? <LoadingIndicator /> : null}
        {!isLoading && selected && !editing ? (
          <div className="announcement-reader-content">
            <Separator />
            <Suspense fallback={<LoadingIndicator />}>
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

          </div>
        ) : null}

        {!isLoading && (selected || isCreateMode) && editing && canUseEditor ? (
          <div className="announcement-editor-layout">
            <div className="announcement-editor-main">
              <div className="announcement-editor-document-fields">
                <div className="announcement-editor-title-field">
                  <span className="announcement-editor-field-label">{t("field.title")}</span>
                  <Input
                    value={titleValue}
                    onChange={(event) => onTitleChange(event.currentTarget.value)}
                    placeholder={t("field.title")}
                    aria-label={t("aria.title")}
                    className="announcement-editor-title-input"
                  />
                </div>
                <div className="announcement-editor-category-field">
                  <span className="announcement-editor-field-label">{t("field.category")}</span>
                  <Select
                    items={ANNOUNCEMENT_CATEGORIES.map((value) => ({
                      value,
                      label: t(`category.${value}`),
                    }))}
                    value={category}
                    onValueChange={(value) => onCategoryChange(value as AnnouncementCategory)}
                  >
                    <SelectTrigger aria-label={t("aria.category")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {ANNOUNCEMENT_CATEGORIES.map((value) => (
                        <SelectItem key={value} value={value}>{t(`category.${value}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="announcement-editor-composer">
                <span className="announcement-editor-field-label">{t("field.body")}</span>
                <Suspense fallback={<LoadingIndicator />}>
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
              </div>

              <AnnouncementEditorAttachments
                attachments={attachments}
                attachmentUploading={attachmentUploading}
                attachmentMaxBytes={attachmentMaxBytes}
                attachmentQuota={attachmentQuota}
                onAttachmentUpload={onAttachmentUpload}
                onAttachmentRemove={onAttachmentRemove}
              />
            </div>

            <aside className="announcement-editor-sidebar" aria-label={t("detail.title")}>
              <h3 className="announcement-editor-sidebar__title">{t("section.publishing")}</h3>
              <div className="announcement-editor-sidebar-actions">
                <div className="announcement-editor-toggle">
                  <span>{t("action.pin")}</span>
                  <Switch
                    checked={pinned}
                    onCheckedChange={(checked) => onPinnedChange(checked)}
                    disabled={savePending || attachmentUploading}
                    aria-label={t("action.pin")}
                  />
                </div>
                {!isCreateMode && canArchive && selected?.status !== "archived" ? (
                  <div className="announcement-editor-toggle">
                    <span>{t("action.archive")}</span>
                    <Switch
                      checked={archiveToggleChecked}
                      onCheckedChange={(checked) => { void handleArchiveToggle(checked); }}
                      disabled={archivePending}
                      aria-busy={archivePending || undefined}
                      aria-label={t("action.archive")}
                    />
                  </div>
                ) : null}
                {!isCreateMode && canDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deletePending}
                    aria-busy={deletePending || undefined}
                    onClick={() => void handleDeleteConfirm()}
                  >
                    <TrashIcon size={16} aria-hidden="true" />
                    {t("action.delete")}
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

        {!isLoading && !selected && selectedId !== "new" ? <EmptyState title={emptyTitle} /> : null}
      </div>
    </Card>
  );
}
