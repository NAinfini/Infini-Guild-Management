import { DepthButton, ImageGridEditor, type ImageGridEditorItem } from "@infini-dev-kit/react";
import { PortalCard } from "../../shared/PortalCard";
import { Badge, Button, Divider, FileButton, Group, Progress, Stack, Text, TextInput } from "@mantine/core";
import { IconDeviceFloppy, IconUpload, IconTrash, IconPlus } from "@tabler/icons-react";
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
  onReorderImages: (nextImages: string[]) => void;
  onRemoveImage: (key: string) => void;
  onRemoveAudio: () => void;
  onSaveProfile: () => void;
  savePending: boolean;
  isDirty: boolean;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

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
  onReorderImages,
  onRemoveImage,
  onRemoveAudio,
  onSaveProfile,
  savePending,
  isDirty,
}: ProfileMediaTabProps) {
  const { t } = useTranslation("profile");
  const imageItems: ImageGridEditorItem[] = imageList.map((key) => ({
    id: key,
    src: isHttpUrl(key) ? key : undefined,
    alt: key,
  }));

  return (
    <Stack gap={16}>
      <PortalCard interactive={false}>
        <Group justify="flex-end" gap={8} p="1.2rem">
          <Badge color={isDirty ? "infini-warning" : "infini-success"}>
            {isDirty ? t("status.unsavedChanges") : t("status.saved")}
          </Badge>
          <Button onClick={onSaveProfile} loading={savePending} leftSection={<IconDeviceFloppy size={16} />}>
            {t("action.saveProfile")}
          </Button>
        </Group>
      </PortalCard>

      {/* ── Images ── */}
      <PortalCard interactive={false}>
        <Stack gap={12} p="1.2rem">
          <Group justify="space-between" align="center">
            <Text fw={700} size="md">{t("media.images")}</Text>
            <Text c="dimmed" size="sm">{t("media.imageCount", { count: imageList.length })}</Text>
          </Group>

          <ImageGridEditor
            items={imageItems}
            onReorder={(items) => onReorderImages(items.map((item) => item.id))}
            onDelete={(item) => onRemoveImage(item.id)}
            onFilesSelected={(files) => imageUploader.selectFiles(files)}
            maxImages={10}
            imageSize={80}
            disabled={imageUploader.isUploading || imageUploader.isConverting}
            aria-label={t("media.images")}
          />

          {imageUploader.files.length > 0 ? (
            <Group gap={8} align="center">
              <Text size="xs" c="dimmed">
                {t("media.filesSelected", { count: imageUploader.files.length })}
              </Text>
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
          ) : null}

          {imageUploader.error ? <Text c="infini-danger" size="sm">{imageUploader.error}</Text> : null}
          {imageUploader.isConverting || imageUploader.isUploading ? (
            <Stack gap={4}>
              <Progress value={imageUploader.conversionProgress} size="xs" animated />
              <Progress value={imageUploader.uploadProgress} size="xs" animated />
            </Stack>
          ) : null}

        </Stack>
      </PortalCard>

      {/* ── Videos ── */}
      <PortalCard interactive={false}>
        <Stack gap={12} p="1.2rem">
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
                      <DepthButton size="sm" type="danger" before={<IconTrash size={16} />} onClick={() => onRemoveVideo(index)}>
                        {t("action.delete")}
                      </DepthButton>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </>
          ) : null}
        </Stack>
      </PortalCard>

      {/* ── Audio ── */}
      <PortalCard interactive={false}>
        <Stack gap={12} p="1.2rem">
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
                <DepthButton size="sm" type="danger" before={<IconTrash size={16} />} onClick={onRemoveAudio}>
                  {t("action.delete")}
                </DepthButton>
              </Group>
            </>
          ) : null}
        </Stack>
      </PortalCard>
    </Stack>
  );
}
