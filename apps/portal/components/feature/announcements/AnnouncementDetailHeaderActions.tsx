import {
  ArchiveIcon,
  CalendarTimeIcon,
  ChevronDownIcon,
  NoteIcon,
  PencilIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";

type AnnouncementPublishMode = "none" | "draft" | "scheduled";

type AnnouncementDetailHeaderActionsProps = {
  isReader: boolean;
  selectedStatus: "published" | "draft" | "archived" | "scheduled" | undefined;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canShowEditorActions: boolean;
  editing: boolean;
  isPublishReady: boolean;
  isDirty: boolean;
  savePending: boolean;
  attachmentUploading: boolean;
  archivePending: boolean;
  deletePending: boolean;
  onStartEditing: () => void;
  onPublish: (mode: AnnouncementPublishMode) => void;
  onArchive: () => void;
  onDelete: () => void;
  onCancelEditing: () => void;
};

export function AnnouncementDetailHeaderActions({
  isReader,
  selectedStatus,
  canEdit,
  canArchive,
  canDelete,
  canShowEditorActions,
  editing,
  isPublishReady,
  isDirty,
  savePending,
  attachmentUploading,
  archivePending,
  deletePending,
  onStartEditing,
  onPublish,
  onArchive,
  onDelete,
  onCancelEditing,
}: AnnouncementDetailHeaderActionsProps) {
  const { t } = useTranslation("announcements");
  const saveBlocked = savePending || attachmentUploading || !isPublishReady;
  const hasReaderActions = isReader
    && !canEdit
    && ((canArchive && selectedStatus !== "archived") || canDelete);

  if (hasReaderActions) {
    return (
      <div className="announcement-reader-actions">
        {canArchive && selectedStatus !== "archived" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={archivePending}
            onClick={onArchive}
          >
            <ArchiveIcon size={14} aria-hidden="true" />
            {t("action.archive")}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            loading={deletePending}
            onClick={onDelete}
          >
            <TrashIcon size={14} aria-hidden="true" />
            {t("action.delete")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (!canShowEditorActions) return null;

  if (!editing) {
    return (
      <div className="announcement-reader-actions">
        <Button type="button" variant="outline" size="sm" onClick={onStartEditing}>
          <PencilIcon size={14} aria-hidden="true" />
          {t("action.edit")}
        </Button>
      </div>
    );
  }

  return (
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
          disabled={saveBlocked}
          aria-busy={savePending || attachmentUploading || undefined}
          onClick={() => onPublish("none")}
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
                disabled={saveBlocked}
                aria-label={`${t("action.saveAsDraft")} / ${t("action.postScheduled")}`}
              />
            )}
          >
            <ChevronDownIcon size={14} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="announcement-publish-menu">
            <DropdownMenuItem onClick={() => onPublish("draft")}>
              <NoteIcon size={16} aria-hidden="true" />
              {t("action.saveAsDraft")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPublish("scheduled")}>
              <CalendarTimeIcon size={16} aria-hidden="true" />
              {t("action.postScheduled")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={savePending} onClick={onCancelEditing}>
        <XIcon size={14} aria-hidden="true" />
        {t("action.cancel")}
      </Button>
    </div>
  );
}
