import { PortalCard } from "../../shared/PortalCard";
import { Group, Progress, Stack, Text, TextInput } from "@mantine/core";
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
  onCaptionChange: (taskId: string, caption: string) => void;
};

export function GalleryUploadQueueCard({
  uploadQueue,
  uploadingCount,
  uploadQueueTitle,
  captionPlaceholder,
  onCaptionChange,
}: GalleryUploadQueueCardProps) {
  const { t } = useTranslation("gallery");

  if (uploadQueue.length === 0) {
    return null;
  }

  return (
    <PortalCard interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={8}>
          <Text fw={600}>{uploadQueueTitle}</Text>
          <Text c="dimmed" size="sm">
            {t("upload.webpHint")}
          </Text>
          {uploadQueue.map((task) => (
            <div key={task.id} aria-live="polite">
              <Group justify="space-between" gap={8} wrap="nowrap">
                <Text>{task.file.name}</Text>
                <Text c="dimmed" size="sm">
                  {fileSizeText(task.file.size)}
                </Text>
              </Group>
              <Progress
                value={PROGRESS_BY_STATUS[task.status]}
                color={task.status === "error" ? "red" : task.status === "done" ? "green" : "blue"}
                size="sm"
                animated={task.status === "uploading"}
                mt={6}
              />
              <TextInput
                value={task.caption}
                maxLength={200}
                placeholder={captionPlaceholder}
                aria-label={t("upload.captionAria", { fileName: task.file.name })}
                disabled={uploadingCount > 0 || task.status === "uploading" || task.status === "done"}
                onChange={(event) => onCaptionChange(task.id, event.currentTarget.value)}
                mt={6}
              />
              {task.error ? (
                <Text c="red" size="sm" mt={4}>
                  {task.error}
                </Text>
              ) : null}
            </div>
          ))}
        </Stack>
      </div>
    </PortalCard>
  );
}


