import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { SectionHeader } from "../../shared/SectionHeader";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { ActionIcon, Button, Fieldset, FileButton, Group, Paper, Progress, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, UploadIcon, VideoIcon } from "@portal/components/icons";
import { AUDIO_FILE_ACCEPT } from "@guild/shared";
import { getVideoThumbnailUrl } from "@guild/shared/utils/video";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { resolveMediaUrl } from "../../../utils/media";

/** 列表里先看站点、再看链接。整条 URL 平铺出来，第一眼读到的是一串参数。 */
function videoHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
  profileAudioMediaId: string | null;
  profileAudioName: string | null;
  maxImages: number;
  imageList: string[];
  videoDraft: string;
  videoList: string[];
  imageUploader: UploaderState;
  audioUploader: UploaderState;
  onReorderImages: (nextImages: string[]) => void;
  onRemoveImage: (mediaId: string) => void;
  removingImageIds: ReadonlySet<string>;
  onUploadImages: () => void;
  onVideoDraftChange: (value: string) => void;
  onAddVideoUrl: () => void;
  onMoveVideo: (index: number, delta: number) => void;
  onRemoveVideo: (index: number) => void;
  onUploadAudio: () => void;
  onRemoveAudio: () => void;
};

/** Profile media workspace for images, video, and audio. */
export function ProfileMediaTab({
  profileAudioMediaId,
  profileAudioName,
  maxImages,
  imageList,
  videoDraft,
  videoList,
  imageUploader,
  audioUploader,
  onReorderImages,
  onRemoveImage,
  removingImageIds,
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

  const imageItems: ImageGridEditorItem[] = imageList.map((mediaId) => ({
    id: mediaId,
    src: resolveMediaUrl(mediaId),
    alt: mediaId,
  }));

  const confirmDelete = async (scope: "removeImage" | "removeAudio") =>
    confirm({
      title: t(`confirm.${scope}.title`),
      description: t(`confirm.${scope}.description`),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });

  const handleRemoveImage = async (mediaId: string) => {
    if (await confirmDelete("removeImage")) onRemoveImage(mediaId);
  };

  const handleRemoveAudio = async () => {
    if (await confirmDelete("removeAudio")) onRemoveAudio();
  };

  // Track the exact File object so a failed auto-upload does not retry forever
  // when `isUploading` returns to false.
  const stagedAudio = audioUploader.files[0] ?? null;
  const autoUploadedAudio = useRef<File | null>(null);
  useEffect(() => {
    if (!stagedAudio || autoUploadedAudio.current === stagedAudio) return;
    autoUploadedAudio.current = stagedAudio;
    onUploadAudio();
  }, [onUploadAudio, stagedAudio]);

  /* 换曲子的过程中先显示手上这个文件，否则名字会停在旧曲子上直到服务端回话。 */
  const audioBusy = audioUploader.isConverting || audioUploader.isUploading;
  const audioName = (audioBusy ? stagedAudio?.name : null) ?? profileAudioName;

  const renderProgress = (uploader: UploaderState) =>
    uploader.isConverting || uploader.isUploading ? (
      <Stack gap={4} mt={8}>
        <Progress value={uploader.conversionProgress} size="xs" animated />
        <Progress value={uploader.uploadProgress} size="xs" animated />
      </Stack>
    ) : null;

  return (
    <Paper withBorder radius="md" p="var(--card-padding)">
      <SectionHeader title={t("section.media")} />

      <Stack gap="var(--space-md)" className="profile-media__groups">
        <Fieldset legend={t("media.group.images", { count: imageList.length })}>
          <ImageGridEditor
            items={imageItems}
            onReorder={(items) => onReorderImages(items.map((item) => item.id))}
            onDelete={(item) => void handleRemoveImage(item.id)}
            onFilesSelected={(files) => imageUploader.selectFiles(files)}
            maxImages={maxImages}
            imageSize={80}
            disabled={imageUploader.isUploading || imageUploader.isConverting}
            deletingIds={removingImageIds}
            aria-label={t("media.images")}
          />

          {imageUploader.files.length > 0 ? (
            <Group gap={8} align="center" mt={12}>
              <Text size="xs" c="dimmed">{t("media.filesSelected", { count: imageUploader.files.length })}</Text>
              <Button
                size="xs"
                h={44}
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
        </Fieldset>

        <Fieldset legend={t("media.group.videos", { count: videoList.length })}>
          <Group gap={8} wrap="nowrap" align="flex-start">
            <TextInput
              style={{ flex: 1 }}
              value={videoDraft}
              onChange={(event) => onVideoDraftChange(event.currentTarget.value)}
              placeholder="https://youtube.com/..."
              aria-label={t("media.videos")}
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
                <Group key={`${item}-${index}`} gap={8} wrap="nowrap" align="center" className="profile-video-row">
                  {/* 缩略图只对拿得到的站点显示（目前是 YouTube）。拿不到的站点
                      给一个视频图标占位，而不是塞一张别处的图冒充这条链接。 */}
                  <span className="profile-video-row__thumb" aria-hidden="true">
                    {getVideoThumbnailUrl(item) ? (
                      <img src={getVideoThumbnailUrl(item) ?? ""} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <VideoIcon size={18} />
                    )}
                  </span>
                  <span className="profile-video-row__meta">
                    <span className="profile-video-row__host">{videoHostLabel(item)}</span>
                    <a
                      className="profile-video-row__url"
                      href={item}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={item}
                    >
                      {item}
                    </a>
                  </span>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label={t("action.up")} withArrow>
                      <span data-disabled-tooltip-target style={{ display: "inline-flex" }}>
                        <ActionIcon
                          size={44}
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
                          size={44}
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
                        size={44}
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
        </Fieldset>

        <Fieldset legend={t("media.group.audio")}>
          {/* 一行说清「现在挂着哪首」，换和删就摆在名字旁边。名字始终占位，空着的
              时候由文案说明是空的，而不是让整行消失。 */}
          <Group gap={8} align="center" wrap="nowrap" className="profile-media-chip-row">
            <Text
              size="sm"
              c={audioName ? undefined : "dimmed"}
              style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
            >
              {audioName ?? t("media.noAudioSelected")}
            </Text>
            <FileButton
              onChange={(files) => audioUploader.selectFiles(files ? [files] : null)}
              accept={AUDIO_FILE_ACCEPT}
            >
              {(props) => (
                <Tooltip label={t("media.selectAudio")} withArrow>
                  <ActionIcon
                    size={44}
                    variant="default"
                    aria-label={t("media.selectAudio")}
                    loading={audioBusy}
                    {...props}
                  >
                    <UploadIcon size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </FileButton>
            <Tooltip label={t("action.delete")} withArrow>
              <span data-disabled-tooltip-target style={{ display: "inline-flex" }}>
                <ActionIcon
                  size={44}
                  color="red"
                  variant="filled"
                  aria-label={t("action.delete")}
                  disabled={!profileAudioMediaId}
                  onClick={() => void handleRemoveAudio()}
                >
                  <TrashIcon size={14} />
                </ActionIcon>
              </span>
            </Tooltip>
          </Group>

          <Text c="dimmed" size="xs" mt={6}>{t("media.audioHint")}</Text>

          {audioUploader.error ? <Text c="red" size="sm" mt={8}>{audioUploader.error}</Text> : null}
          {renderProgress(audioUploader)}
        </Fieldset>
      </Stack>
    </Paper>
  );
}
