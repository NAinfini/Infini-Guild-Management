import { RefreshCwIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Progress } from "@portal/components/ui/progress";
import { useTranslation } from "react-i18next";
import type { UploadStatus, UploadTask } from "@portal/types/media";

const PROGRESS_BY_STATUS = {
  queued: 0,
  uploading: 55,
  done: 100,
  error: 100,
} satisfies Record<UploadStatus, number>;

function fileSizeText(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

type GalleryUploadQueueCardProps = {
  uploadQueue: UploadTask[];
  uploadingCount: number;
  uploadQueueTitle: string;
  captionPlaceholder: string;
  retryLabel: string;
  removeLabel: string;
  canRetryUpload: (task: UploadTask) => boolean;
  onCaptionChange: (taskId: string, caption: string) => void;
  onRetry: (taskId: string) => void;
  onRemove: (taskId: string) => void;
};

export function GalleryUploadQueueCard({
  uploadQueue,
  uploadingCount,
  uploadQueueTitle,
  captionPlaceholder,
  retryLabel,
  removeLabel,
  canRetryUpload,
  onCaptionChange,
  onRetry,
  onRemove,
}: GalleryUploadQueueCardProps) {
  const { t } = useTranslation("gallery");

  if (uploadQueue.length === 0) {
    return null;
  }

  return (
    <Card className="gallery-upload-queue">
      <div className="gallery-upload-queue__header">
        <h3>{uploadQueueTitle}</h3>
        <p>{t("upload.webpHint")}</p>
      </div>
      <div className="gallery-upload-queue__items">
        {uploadQueue.map((task) => (
          <article key={task.id} className="gallery-upload-task" aria-live="polite">
            <div className="gallery-upload-task__heading">
              <span className="gallery-upload-task__name" title={task.file.name}>{task.file.name}</span>
              <span className="gallery-upload-task__size">{fileSizeText(task.file.size)}</span>
            </div>
            <Progress
              value={PROGRESS_BY_STATUS[task.status]}
              aria-label={task.file.name}
              className={`gallery-upload-task__progress gallery-upload-task__progress--${task.status}`}
            />
            <Input
              value={task.caption}
              maxLength={200}
              placeholder={captionPlaceholder}
              aria-label={t("upload.captionAria", { fileName: task.file.name })}
              disabled={uploadingCount > 0 || task.status === "uploading" || task.status === "done"}
              onChange={(event) => onCaptionChange(task.id, event.currentTarget.value)}
              className="gallery-upload-task__caption"
            />
            {task.error ? <p className="gallery-upload-task__error" role="alert">{task.error}</p> : null}
            {task.status === "queued" || task.status === "error" ? (
              <div className="gallery-upload-task__actions">
                {canRetryUpload(task) ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={uploadingCount > 0}
                    onClick={() => onRetry(task.id)}
                  >
                    <RefreshCwIcon size={14} aria-hidden="true" />
                    {retryLabel}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={uploadingCount > 0}
                  onClick={() => onRemove(task.id)}
                >
                  <XIcon size={14} aria-hidden="true" />
                  {removeLabel}
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </Card>
  );
}
