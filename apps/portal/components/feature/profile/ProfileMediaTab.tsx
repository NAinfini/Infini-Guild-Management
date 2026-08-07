import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { SectionHeader } from "../../shared/SectionHeader";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { ActionIcon, Button, FileButton, Group, Paper, Progress, SegmentedControl, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, UploadIcon, VideoIcon } from "@portal/components/icons";
import { getVideoThumbnailUrl } from "@guild/shared/utils/video";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveProfileMediaUrl } from "../../../utils/media";

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

type MediaSection = "images" | "videos" | "audio";

type ProfileMediaTabProps = {
  profileAudioKey: string | null;
  imageList: string[];
  videoDraft: string;
  videoList: string[];
  imageUploader: UploaderState;
  audioUploader: UploaderState;
  onReorderImages: (nextImages: string[]) => void;
  onRemoveImage: (key: string) => void;
  removingImageKeys: ReadonlySet<string>;
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
  profileAudioKey,
  imageList,
  videoDraft,
  videoList,
  imageUploader,
  audioUploader,
  onReorderImages,
  onRemoveImage,
  removingImageKeys,
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
  const [section, setSection] = useState<MediaSection>("images");

  const imageItems: ImageGridEditorItem[] = imageList.map((key) => ({
    id: key,
    src: resolveProfileMediaUrl(key),
    alt: key,
  }));

  const confirmDelete = async (scope: "removeImage" | "removeAudio") =>
    confirm({
      title: t(`confirm.${scope}.title`),
      description: t(`confirm.${scope}.description`),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });

  const handleRemoveImage = async (key: string) => {
    if (await confirmDelete("removeImage")) onRemoveImage(key);
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

  const renderProgress = (uploader: UploaderState) =>
    uploader.isConverting || uploader.isUploading ? (
      <Stack gap={4} mt={8}>
        <Progress value={uploader.conversionProgress} size="xs" animated />
        <Progress value={uploader.uploadProgress} size="xs" animated />
      </Stack>
    ) : null;

  return (
    <Paper withBorder radius="md" p="var(--card-padding)">
      <SectionHeader
        title={t("section.media")}
        trailing={
          <SegmentedControl
            size="xs"
            value={section}
            onChange={(value) => setSection(value as MediaSection)}
            className="profile-media__switch"
            data={[
              { value: "images", label: t("media.tab.images", { count: imageList.length }) },
              { value: "videos", label: t("media.tab.videos", { count: videoList.length }) },
              { value: "audio", label: t(profileAudioKey ? "media.tab.audioSet" : "media.tab.audioEmpty") },
            ]}
          />
        }
      />

      <div className="profile-media__body">
        {section === "images" ? (
          <>
            <ImageGridEditor
              items={imageItems}
              onReorder={(items) => onReorderImages(items.map((item) => item.id))}
              onDelete={(item) => void handleRemoveImage(item.id)}
              onFilesSelected={(files) => imageUploader.selectFiles(files)}
              maxImages={10}
              imageSize={80}
              disabled={imageUploader.isUploading || imageUploader.isConverting}
              deletingIds={removingImageKeys}
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
          </>
        ) : null}

        {section === "videos" ? (
          <>
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
          </>
        ) : null}

        {section === "audio" ? (
          <>
            <Group gap={8} align="center">
              <FileButton
                onChange={(files) => audioUploader.selectFiles(files ? [files] : null)}
                accept="audio/ogg,audio/webm,audio/mp4,audio/mpeg,audio/wav"
              >
                {(props) => (
                  <Button
                    variant="default"
                    size="xs"
                    h={44}
                    loading={audioUploader.isUploading}
                    leftSection={<UploadIcon size={14} />}
                    {...props}
                  >
                    {t("media.selectAudio")}
                  </Button>
                )}
              </FileButton>
              {stagedAudio ? (
                <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {stagedAudio.name}
                </Text>
              ) : null}
            </Group>

            <Text c="dimmed" size="xs" mt={6}>{t("media.audioHint")}</Text>

            {audioUploader.error ? <Text c="red" size="sm" mt={8}>{audioUploader.error}</Text> : null}
            {renderProgress(audioUploader)}

            {profileAudioKey ? (
              <Group gap={8} align="center" mt={12} className="profile-media-chip-row">
                <Text size="sm" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {profileAudioKey.split("/").pop()}
                </Text>
                <Tooltip label={t("action.delete")} withArrow>
                  <ActionIcon
                    size={44}
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
          </>
        ) : null}
      </div>
    </Paper>
  );
}
