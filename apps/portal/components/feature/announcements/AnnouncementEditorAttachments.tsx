import type { AnnouncementAttachment } from "@guild/shared";
import { UploadIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { AnnouncementAttachmentItem } from "./AnnouncementAttachmentItem";

type AnnouncementEditorAttachmentsProps = {
  attachments: AnnouncementAttachment[];
  attachmentUploading: boolean;
  attachmentMaxBytes: number;
  attachmentQuota: number;
  onAttachmentUpload: (file: File) => Promise<void>;
  onAttachmentRemove: (mediaId: string) => void;
};

export function AnnouncementEditorAttachments({
  attachments,
  attachmentUploading,
  attachmentMaxBytes,
  attachmentQuota,
  onAttachmentUpload,
  onAttachmentRemove,
}: AnnouncementEditorAttachmentsProps) {
  const { t } = useTranslation("announcements");
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void onAttachmentUpload(file).finally(() => {
      input.value = "";
    });
  };

  return (
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
  );
}
