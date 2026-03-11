import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Group, Progress, Stack, Text, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { UploadStatus, UploadTask } from "./shared";

function progressByStatus(status: UploadStatus): number {
  if (status === "queued") return 0;
  if (status === "uploading") return 55;
  if (status === "done") return 100;
  return 100;
}

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
    <InfiniCard interactive={false}>
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
                value={progressByStatus(task.status)}
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
                <Text c="infini-danger" size="sm" mt={4}>
                  {task.error}
                </Text>
              ) : null}
            </div>
          ))}
        </Stack>
      </div>
    </InfiniCard>
  );
}


