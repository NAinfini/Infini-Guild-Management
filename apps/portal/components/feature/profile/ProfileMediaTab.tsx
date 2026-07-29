import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { SectionHeader } from "../../shared/SectionHeader";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { ActionIcon, Avatar, Button, FileButton, Grid, Group, Paper, Progress, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, UploadIcon, UserIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { resolveProfileMediaUrl } from "../../../utils/media";

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
  avatarKey: string | null;
  profileAudioKey: string | null;
  imageList: string[];
  videoDraft: string;
  videoList: string[];
  imageUploader: UploaderState;
  audioUploader: UploaderState;
  avatarUploading: boolean;
  onUploadAvatar: (file: File) => void;
  onRemoveAvatar: () => void;
  onReorderImages: (nextImages: string[]) => void;
  onRemoveImage: (key: string) => void;
  onUploadImages: () => void;
  onVideoDraftChange: (value: string) => void;
  onAddVideoUrl: () => void;
  onMoveVideo: (index: number, delta: number) => void;
  onRemoveVideo: (index: number) => void;
  onUploadAudio: () => void;
  onRemoveAudio: () => void;
};

/**
 * 媒体标签页。原先这四组（头像 / 图片 / 视频 / 音频）挤在「资料」页右半栏里，
 * 而左半栏只有四个字段，两边靠 height:100% 硬拉齐，简介下面永远空一大块。
 * 拆出来之后两边都按自己的内容排版，不再互相迁就。
 */
export function ProfileMediaTab({
  avatarKey,
  profileAudioKey,
  imageList,
  videoDraft,
  videoList,
  imageUploader,
  audioUploader,
  avatarUploading,
  onUploadAvatar,
  onRemoveAvatar,
  onReorderImages,
  onRemoveImage,
  onUploadImages,
  onVideoDraftChange,
  onAddVideoUrl,
  onMoveVideo,
  onRemoveVideo,
  onUploadAudio,
  onRemoveAudio,
}: ProfileMediaTabProps) {
  const { t } = useTranslation("profile");
  const confirm = useConfirmDialog();

  const imageItems: ImageGridEditorItem[] = imageList.map((key) => ({
    id: key,
    src: resolveProfileMediaUrl(key),
    alt: key,
  }));

  const confirmDelete = async (scope: "removeAvatar" | "removeImage" | "removeAudio") =>
    confirm({
      title: t(`confirm.${scope}.title`),
      description: t(`confirm.${scope}.description`),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });

  const handleRemoveAvatar = async () => {
    if (await confirmDelete("removeAvatar")) onRemoveAvatar();
  };

  const handleRemoveImage = async (key: string) => {
    if (await confirmDelete("removeImage")) onRemoveImage(key);
  };

  const handleRemoveAudio = async () => {
    if (await confirmDelete("removeAudio")) onRemoveAudio();
  };

  /* 转换与上传两条进度条原先是两条没有说明的匿名细条，看不出谁是谁。 */
  const renderProgress = (uploader: UploaderState) =>
    uploader.isConverting || uploader.isUploading ? (
      <Stack gap={4} mt={8}>
        <Progress value={uploader.conversionProgress} size="xs" animated />
        <Progress value={uploader.uploadProgress} size="xs" animated />
      </Stack>
    ) : null;

  return (
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Paper withBorder radius="md" p="var(--card-padding)">
          <div>
            <SectionHeader title={t("media.avatar")} />
          <Group gap={16} align="center">
            <Avatar
              size={64}
              radius="xl"
              src={avatarKey ? resolveProfileMediaUrl(avatarKey) : undefined}
              className="profile-media-avatar"
            >
              <UserIcon size={28} />
            </Avatar>
            <Stack gap={8}>
              <FileButton
                onChange={(file) => { if (file) onUploadAvatar(file); }}
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
              >
                {(props) => (
                  <Button variant="default" size="xs" loading={avatarUploading} leftSection={<UploadIcon size={14} />} {...props}>
                    {t("media.uploadAvatar")}
                  </Button>
                )}
              </FileButton>
              {avatarKey ? (
                <Button color="red" size="xs" leftSection={<TrashIcon size={12} />} onClick={() => void handleRemoveAvatar()}>
                  {t("media.removeAvatar")}
                </Button>
              ) : null}
            </Stack>
            </Group>
          </div>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 8 }}>
        <Paper withBorder radius="md" p="var(--card-padding)">
          <div>
            <SectionHeader
            title={t("media.images")}
            trailing={t("media.imageCount", { count: imageList.length })}
          />
          <ImageGridEditor
            items={imageItems}
            onReorder={(items) => onReorderImages(items.map((item) => item.id))}
            onDelete={(item) => void handleRemoveImage(item.id)}
            onFilesSelected={(files) => imageUploader.selectFiles(files)}
            maxImages={10}
            imageSize={80}
            disabled={imageUploader.isUploading || imageUploader.isConverting}
            aria-label={t("media.images")}
          />

          {imageUploader.files.length > 0 ? (
            <Group gap={8} align="center" mt={12}>
              <Text size="xs" c="dimmed">{t("media.filesSelected", { count: imageUploader.files.length })}</Text>
              <Button
                size="xs"
                onClick={onUploadImages}
                loading={imageUploader.isUploading}
                leftSection={<UploadIcon size={14} />}
              >
                {t("action.upload")}
              </Button>
            </Group>
          ) : null}

          {imageUploader.error ? <Text c="red" size="sm" mt={8}>{imageUploader.error}</Text> : null}
            {renderProgress(imageUploader)}
          </div>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 6 }}>
        <Paper withBorder radius="md" p="var(--card-padding)">
          <div>
            <SectionHeader
            title={t("media.videos")}
            trailing={t("media.videoCount", { count: videoList.length })}
          />
          <Group gap={8} wrap="nowrap" align="flex-start">
            <TextInput
              style={{ flex: 1 }}
              value={videoDraft}
              onChange={(event) => onVideoDraftChange(event.currentTarget.value)}
              placeholder="https://youtube.com/..."
              onKeyDown={(event) => { if (event.key === "Enter") onAddVideoUrl(); }}
            />
            <Button size="sm" onClick={onAddVideoUrl} leftSection={<PlusIcon size={14} />}>
              {t("action.add")}
            </Button>
          </Group>
          <Text c="dimmed" size="xs" mt={6}>{t("media.videoHostHint")}</Text>

          {videoList.length > 0 ? (
            <Stack gap={6} mt={12}>
              {videoList.map((item, index) => (
                <Group key={`${item}-${index}`} gap={8} wrap="nowrap" align="center" className="profile-media-chip-row">
                  <Text size="sm" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{item}</Text>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label={t("action.up")} withArrow>
                      <span data-disabled-tooltip-target style={{ display: "inline-flex" }}>
                        <ActionIcon
                          size="xs"
                          variant="default"
                          aria-label={t("action.up")}
                          disabled={index === 0}
                          onClick={() => onMoveVideo(index, -1)}
                        >
                          <ArrowUpIcon size={14} />
                        </ActionIcon>
                      </span>
                    </Tooltip>
                    <Tooltip label={t("action.down")} withArrow>
                      <span data-disabled-tooltip-target style={{ display: "inline-flex" }}>
                        <ActionIcon
                          size="xs"
                          variant="default"
                          aria-label={t("action.down")}
                          disabled={index === videoList.length - 1}
                          onClick={() => onMoveVideo(index, 1)}
                        >
                          <ArrowDownIcon size={14} />
                        </ActionIcon>
                      </span>
                    </Tooltip>
                    <Tooltip label={t("action.delete")} withArrow>
                      <ActionIcon
                        size="xs"
                        color="red"
                        variant="filled"
                        aria-label={t("action.delete")}
                        onClick={() => onRemoveVideo(index)}
                      >
                        <TrashIcon size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              ))}
            </Stack>
            ) : null}
          </div>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 6 }}>
        <Paper withBorder radius="md" p="var(--card-padding)">
          <div>
            <SectionHeader
            title={t("media.audio")}
            trailing={profileAudioKey ? t("media.audioUploaded") : t("media.noAudio")}
          />
          <Group gap={8} align="center">
            <FileButton
              onChange={(files) => audioUploader.selectFiles(files ? [files] : null)}
              accept="audio/ogg,audio/webm,audio/mp4,audio/mpeg,audio/wav"
            >
              {(props) => (
                <Button variant="default" size="xs" {...props}>{t("media.selectAudio")}</Button>
              )}
            </FileButton>
            {audioUploader.files.length > 0 ? (
              <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {audioUploader.files[0]?.name}
              </Text>
            ) : null}
            <Button
              size="xs"
              onClick={onUploadAudio}
              disabled={audioUploader.files.length === 0}
              loading={audioUploader.isUploading}
              leftSection={<UploadIcon size={14} />}
            >
              {t("action.upload")}
            </Button>
          </Group>

          {audioUploader.error ? <Text c="red" size="sm" mt={8}>{audioUploader.error}</Text> : null}
          {renderProgress(audioUploader)}

          {profileAudioKey ? (
            <Group gap={8} align="center" mt={12} className="profile-media-chip-row">
              <Text size="sm" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {profileAudioKey.split("/").pop()}
              </Text>
              <Tooltip label={t("action.delete")} withArrow>
                <ActionIcon
                  size="xs"
                  color="red"
                  variant="filled"
                  aria-label={t("action.delete")}
                  onClick={() => void handleRemoveAudio()}
                >
                  <TrashIcon size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
            ) : null}
          </div>
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
