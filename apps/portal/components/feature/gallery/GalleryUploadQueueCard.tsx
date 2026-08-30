import { PhotoIcon, RefreshCwIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Textarea } from "@portal/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { LIMITS } from "@guild/shared/config/limits";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UploadTask } from "@portal/types/media";

function fileSizeText(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function GalleryUploadPreview({ task }: { task: UploadTask }) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const nextSource = URL.createObjectURL(task.file);
    setSource(nextSource);
    return () => URL.revokeObjectURL(nextSource);
  }, [task.file]);

  return source ? (
    <img className="gallery-upload-task__preview" src={source} alt="" />
  ) : (
    <span className="gallery-upload-task__preview-fallback" aria-hidden="true">
      <PhotoIcon size={22} />
    </span>
  );
}

type GalleryUploadQueueCardProps = {
  uploadQueue: UploadTask[];
  uploadingCount: number;
  uploadQueueTitle: string;
  titlePlaceholder: string;
  descriptionPlaceholder: string;
  retryLabel: string;
  removeLabel: string;
  canRetryUpload: (task: UploadTask) => boolean;
  onTitleChange: (taskId: string, title: string) => void;
  onDescriptionChange: (taskId: string, description: string) => void;
  onRetry: (taskId: string) => void;
  onRemove: (taskId: string) => void;
};

export function GalleryUploadQueueCard({
  uploadQueue,
  uploadingCount,
  uploadQueueTitle,
  titlePlaceholder,
  descriptionPlaceholder,
  retryLabel,
  removeLabel,
  canRetryUpload,
  onTitleChange,
  onDescriptionChange,
  onRetry,
  onRemove,
}: GalleryUploadQueueCardProps) {
  const { t } = useTranslation("gallery");

  if (uploadQueue.length === 0) {
    return null;
  }

  return (
    <section className="gallery-upload-queue" aria-labelledby="gallery-upload-queue-title">
      <div className="gallery-upload-queue__header">
        <div>
          <h3 id="gallery-upload-queue-title">{uploadQueueTitle}</h3>
          <span className="gallery-upload-queue__count">{uploadQueue.length}</span>
        </div>
        <p>{t("upload.webpHint")}</p>
      </div>
      <ol className="gallery-upload-queue__items">
        {uploadQueue.map((task) => (
          <li key={task.id} className="gallery-upload-task">
            <div className="gallery-upload-task__identity">
              <GalleryUploadPreview task={task} />
              <div className="gallery-upload-task__heading">
                <Tooltip>
                  <TooltipTrigger render={<span className="gallery-upload-task__name" tabIndex={0} />}>
                    {task.file.name}
                  </TooltipTrigger>
                  <TooltipContent>{task.file.name}</TooltipContent>
                </Tooltip>
                <span className="gallery-upload-task__meta">
                  <span className={`gallery-upload-task__status gallery-upload-task__status--${task.status}`}>
                    {t(`upload.status.${task.status}`)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="gallery-upload-task__size">{fileSizeText(task.file.size)}</span>
                </span>
              </div>
            </div>
            <label className="gallery-upload-task__field">
              <span className="gallery-upload-task__label">
                <span>{t("field.title")}</span>
                <span>{t("field.required")}</span>
              </span>
              <Input
                value={task.title}
                maxLength={LIMITS.content.galleryTitle.max}
                placeholder={titlePlaceholder}
                aria-label={t("upload.titleAria", { fileName: task.file.name })}
                required
                aria-invalid={!task.title.trim()}
                disabled={uploadingCount > 0 || task.status === "uploading" || task.status === "done"}
                onChange={(event) => onTitleChange(task.id, event.currentTarget.value)}
                className="gallery-upload-task__title"
              />
              <small>{task.title.length} / {LIMITS.content.galleryTitle.max}</small>
            </label>
            <label className="gallery-upload-task__field">
              <span className="gallery-upload-task__label">
                <span>{t("field.description")}</span>
                <span>{t("field.optional")}</span>
              </span>
              <Textarea
                value={task.description}
                maxLength={LIMITS.content.galleryDescription.max}
                placeholder={descriptionPlaceholder}
                aria-label={t("upload.descriptionAria", { fileName: task.file.name })}
                disabled={uploadingCount > 0 || task.status === "uploading" || task.status === "done"}
                onChange={(event) => onDescriptionChange(task.id, event.currentTarget.value)}
                className="gallery-upload-task__description"
                rows={2}
              />
              <small>{task.description.length} / {LIMITS.content.galleryDescription.max}</small>
            </label>
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
          </li>
        ))}
      </ol>
    </section>
  );
}
