import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { SectionHeader } from "../../shared/SectionHeader";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { ActionIcon, Avatar, Button, FileButton, Group, Paper, Progress, SegmentedControl, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, UploadIcon, UserIcon, VideoIcon } from "@portal/components/icons";
import { IMAGE_FILE_ACCEPT } from "@guild/shared";
import { getVideoThumbnailUrl } from "@guild/shared/utils/video";
import { useState } from "react";
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

type MediaSection = "images" | "videos" | "audio" | "avatar";

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
 * 媒体卡：相册 / 视频 / 语音 / 头像 收进一条内嵌切换。
 *
 * 这四组原先是四张各自撑开高度的卡，占满一整个标签页；现在它们和身份卡同处
 * 「主页」屏，必须让出高度。切换条上带计数，所以收起来也知道每组有多少。
 * 代价是四组不能同屏对照——但它们之间本来就没有需要对照的关系。
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
  const [section, setSection] = useState<MediaSection>("images");

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
    <Paper withBorder radius="md" p="var(--card-padding)">
      {/* 切换条放进标题行的右侧：它自己独占一行时，左边一整段空白没有任何东西，
          而它和「媒体」本来就是同一层——选的是这张卡里显示哪一组。 */}
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
              { value: "avatar", label: t("media.avatar") },
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
                  <Button variant="default" size="xs" h={44} {...props}>{t("media.selectAudio")}</Button>
                )}
              </FileButton>
              {audioUploader.files.length > 0 ? (
                <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {audioUploader.files[0]?.name}
                </Text>
              ) : null}
              <Button
                size="xs"
                h={44}
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

        {section === "avatar" ? (
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
                accept={IMAGE_FILE_ACCEPT}
              >
                {(props) => (
                  <Button variant="default" size="xs" h={44} loading={avatarUploading} leftSection={<UploadIcon size={14} />} {...props}>
                    {t("media.uploadAvatar")}
                  </Button>
                )}
              </FileButton>
              {avatarKey ? (
                <Button color="red" size="xs" h={44} leftSection={<TrashIcon size={12} />} onClick={() => void handleRemoveAvatar()}>
                  {t("media.removeAvatar")}
                </Button>
              ) : null}
            </Stack>
          </Group>
        ) : null}
      </div>
    </Paper>
  );
}
