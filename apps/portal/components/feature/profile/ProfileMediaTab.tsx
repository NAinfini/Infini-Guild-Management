import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Button, Divider, FileButton, Group, Progress, Stack, Text, TextInput } from "@mantine/core";
import { IconUpload, IconTrash, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

type UploaderState = {
  files: File[];
  supportError: string | null;
  isUploading: boolean;
  isConverting: boolean;
  conversionProgress: number;
  uploadProgress: number;
  error: string | null;
  selectFiles: (source: FileList | File[] | null) => void;
};

type ProfileMediaTabProps = {
  videoDraft: string;
  videoList: string[];
  imageList: string[];
  profileAudioKey: string | null;
  imageUploader: UploaderState;
  audioUploader: UploaderState;
  onVideoDraftChange: (value: string) => void;
  onAddVideoUrl: () => void;
  onMoveVideo: (index: number, delta: number) => void;
  onRemoveVideo: (index: number) => void;
  onUploadImages: () => void;
  onUploadAudio: () => void;
  onMoveImage: (index: number, delta: number) => void;
  onRemoveImage: (key: string) => void;
  onRemoveAudio: () => void;
};

export function ProfileMediaTab({
  videoDraft,
  videoList,
  imageList,
  profileAudioKey,
  imageUploader,
  audioUploader,
  onVideoDraftChange,
  onAddVideoUrl,
  onMoveVideo,
  onRemoveVideo,
  onUploadImages,
  onUploadAudio,
  onMoveImage,
  onRemoveImage,
  onRemoveAudio,
}: ProfileMediaTabProps) {
  const { t } = useTranslation("profile");

  return (
    <Stack gap={16}>
      {/* ── Images ── */}
      <InfiniCard interactive={false}>
        <Stack gap={12} style={{ padding: "1.2rem" }}>
          <Group justify="space-between" align="center">
            <Text fw={700} size="md">{t("media.images")}</Text>
            <Text c="dimmed" size="sm">{t("media.imageCount", { count: imageList.length })}</Text>
          </Group>

          <Group gap={8} align="flex-end">
            <FileButton
              onChange={(files) => imageUploader.selectFiles(files)}
              accept="image/*"
              multiple
            >
              {(props) => (
                <Button variant="light" size="compact-sm" {...props}>
                  {t("media.selectImages")}
                </Button>
              )}
            </FileButton>
            {imageUploader.files.length > 0 ? (
              <Text size="xs" c="dimmed">
                {t("media.filesSelected", { count: imageUploader.files.length })}
              </Text>
            ) : null}
            <Button
              size="compact-sm"
              onClick={onUploadImages}
              disabled={imageUploader.files.length === 0}
              loading={imageUploader.isUploading}
              leftSection={<IconUpload size={16} />}
            >
              {t("action.upload")}
            </Button>
          </Group>

          {imageUploader.error ? <Text c="infini-danger" size="sm">{imageUploader.error}</Text> : null}
          {imageUploader.isConverting || imageUploader.isUploading ? (
            <Stack gap={4}>
              <Progress value={imageUploader.conversionProgress} size="xs" animated />
              <Progress value={imageUploader.uploadProgress} size="xs" animated />
            </Stack>
          ) : null}

          {imageList.length > 0 ? (
            <>
              <Divider />
              <Stack gap={6}>
                {imageList.map((imageKey, index) => (
                  <Group key={`${imageKey}-${index}`} gap={8} wrap="wrap" align="center">
                    <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate="end">{imageKey}</Text>
                    <Group gap={4} wrap="nowrap">
                      <Button size="compact-xs" variant="default" onClick={() => onMoveImage(index, -1)} disabled={index === 0}>
                        {t("action.up")}
                      </Button>
                      <Button size="compact-xs" variant="default" onClick={() => onMoveImage(index, 1)} disabled={index === imageList.length - 1}>
                        {t("action.down")}
                      </Button>
                      <Button size="compact-xs" color="infini-danger" variant="light" leftSection={<IconTrash size={16} />} onClick={() => onRemoveImage(imageKey)}>
                        {t("action.delete")}
                      </Button>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </>
          ) : null}
        </Stack>
      </InfiniCard>

      {/* ── Videos ── */}
      <InfiniCard interactive={false}>
        <Stack gap={12} style={{ padding: "1.2rem" }}>
          <Group justify="space-between" align="center">
            <Text fw={700} size="md">{t("media.videos")}</Text>
            <Text c="dimmed" size="sm">{t("media.videoCount", { count: videoList.length })}</Text>
          </Group>

          <Group gap={8} wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={videoDraft}
              onChange={(event) => onVideoDraftChange(event.currentTarget.value)}
              placeholder="https://youtube.com/..."
              onKeyDown={(event) => {
                if (event.key === "Enter") onAddVideoUrl();
              }}
            />
            <Button size="compact-sm" onClick={onAddVideoUrl} leftSection={<IconPlus size={16} />}>{t("action.add")}</Button>
          </Group>

          <Text c="dimmed" size="xs">{t("media.videoHostHint")}</Text>

          {videoList.length > 0 ? (
            <>
              <Divider />
              <Stack gap={6}>
                {videoList.map((item, index) => (
                  <Group key={`${item}-${index}`} gap={8} wrap="wrap" align="center">
                    <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate="end">{item}</Text>
                    <Group gap={4} wrap="nowrap">
                      <Button size="compact-xs" variant="default" onClick={() => onMoveVideo(index, -1)} disabled={index === 0}>
                        {t("action.up")}
                      </Button>
                      <Button size="compact-xs" variant="default" onClick={() => onMoveVideo(index, 1)} disabled={index === videoList.length - 1}>
                        {t("action.down")}
                      </Button>
                      <Button size="compact-xs" color="infini-danger" variant="light" leftSection={<IconTrash size={16} />} onClick={() => onRemoveVideo(index)}>
                        {t("action.delete")}
                      </Button>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </>
          ) : null}
        </Stack>
      </InfiniCard>

      {/* ── Audio ── */}
      <InfiniCard interactive={false}>
        <Stack gap={12} style={{ padding: "1.2rem" }}>
          <Group justify="space-between" align="center">
            <Text fw={700} size="md">{t("media.audio")}</Text>
            <Text c="dimmed" size="sm">{profileAudioKey ? t("media.audioUploaded") : t("media.noAudio")}</Text>
          </Group>

          <Text c="dimmed" size="xs">{t("media.audioHint")}</Text>

          {audioUploader.supportError ? (
            <Text c="infini-warning" size="sm">{audioUploader.supportError}</Text>
          ) : null}

          <Group gap={8} align="flex-end">
            <FileButton
              onChange={(files) => audioUploader.selectFiles(files ? [files] : null)}
              accept="audio/*"
            >
              {(props) => (
                <Button
                  variant="light"
                  size="compact-sm"
                  disabled={Boolean(audioUploader.supportError)}
                  {...props}
                >
                  {t("media.selectAudio")}
                </Button>
              )}
            </FileButton>
            {audioUploader.files.length > 0 ? (
              <Text size="xs" c="dimmed">{audioUploader.files[0]?.name}</Text>
            ) : null}
            <Button
              size="compact-sm"
              onClick={onUploadAudio}
              disabled={Boolean(audioUploader.supportError) || audioUploader.files.length === 0}
              loading={audioUploader.isUploading}
              leftSection={<IconUpload size={16} />}
            >
              {t("action.upload")}
            </Button>
          </Group>

          {audioUploader.error ? <Text c="infini-danger" size="sm">{audioUploader.error}</Text> : null}
          {audioUploader.isConverting || audioUploader.isUploading ? (
            <Stack gap={4}>
              <Progress value={audioUploader.conversionProgress} size="xs" animated />
              <Progress value={audioUploader.uploadProgress} size="xs" animated />
            </Stack>
          ) : null}

          {profileAudioKey ? (
            <>
              <Divider />
              <Group gap={8} align="center">
                <Text size="sm" style={{ flex: 1 }} truncate="end">{profileAudioKey}</Text>
                <Button size="compact-xs" color="infini-danger" variant="light" leftSection={<IconTrash size={16} />} onClick={onRemoveAudio}>
                  {t("action.delete")}
                </Button>
              </Group>
            </>
          ) : null}
        </Stack>
      </InfiniCard>
    </Stack>
  );
}
