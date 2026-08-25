import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { SectionHeader } from "../../shared/SectionHeader";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Progress } from "@portal/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
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

  const audioInputRef = useRef<HTMLInputElement>(null);

  const renderProgress = (uploader: UploaderState) =>
    uploader.isConverting || uploader.isUploading ? (
      <div className="profile-media__progress">
        <Progress value={uploader.conversionProgress} aria-label={t("media.conversionProgress")} />
        <Progress value={uploader.uploadProgress} aria-label={t("media.uploadProgress")} />
      </div>
    ) : null;

  return (
    <Card className="profile-media-card gap-0 py-0">
      <SectionHeader title={t("section.media")} />

      <div className="profile-media__groups">
        <fieldset className="profile-media__group">
          <legend>{t("media.group.images", { count: imageList.length })}</legend>
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
            <div className="profile-media__selected-files">
              <span>{t("media.filesSelected", { count: imageUploader.files.length })}</span>
              <Button
                size="xs"
                className="profile-media__upload-button"
                onClick={onUploadImages}
                loading={imageUploader.isUploading}
              >
                <UploadIcon size={14} data-icon="inline-start" />
                {t("action.upload")}
              </Button>
            </div>
          ) : null}

          {imageUploader.error ? <p className="profile-media__error" role="alert">{imageUploader.error}</p> : null}
          {renderProgress(imageUploader)}
        </fieldset>

        <fieldset className="profile-media__group">
          <legend>{t("media.group.videos", { count: videoList.length })}</legend>
          <div className="profile-media__video-entry">
            <Input
              value={videoDraft}
              onChange={(event) => onVideoDraftChange(event.currentTarget.value)}
              placeholder="https://youtube.com/..."
              aria-label={t("media.videos")}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onAddVideoUrl();
              }}
            />
            <Button size="default" onClick={onAddVideoUrl}>
              <PlusIcon size={14} data-icon="inline-start" />
              {t("action.add")}
            </Button>
          </div>
          <p className="profile-media__hint">{t("media.videoHostHint")}</p>

          {videoList.length > 0 ? (
            <div className="profile-media__video-list">
              {videoList.map((item, index) => (
                <div key={`${item}-${index}`} className="profile-video-row">
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
                    <Tooltip>
                      <TooltipTrigger render={<a
                        className="profile-video-row__url"
                        href={item}
                        target="_blank"
                        rel="noreferrer noopener"
                      />}>
                        {item}
                      </TooltipTrigger>
                      <TooltipContent>{item}</TooltipContent>
                    </Tooltip>
                  </span>
                  <div className="profile-media__row-actions">
                    <Tooltip>
                      <TooltipTrigger render={<Button
                          type="button"
                          size="icon-lg"
                          variant="outline"
                          className="profile-media__icon-button"
                          aria-label={t("action.up")}
                          disabled={index === 0}
                          onClick={() => onMoveVideo(index, -1)}
                        />}>
                          <ArrowUpIcon size={14} />
                      </TooltipTrigger>
                      <TooltipContent>{t("action.up")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={<Button
                          type="button"
                          size="icon-lg"
                          variant="outline"
                          className="profile-media__icon-button"
                          aria-label={t("action.down")}
                          disabled={index === videoList.length - 1}
                          onClick={() => onMoveVideo(index, 1)}
                        />}>
                          <ArrowDownIcon size={14} />
                      </TooltipTrigger>
                      <TooltipContent>{t("action.down")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={<Button
                        type="button"
                        size="icon-lg"
                        variant="destructive"
                        className="profile-media__icon-button"
                        aria-label={t("action.delete")}
                        onClick={() => onRemoveVideo(index)}
                      />}>
                        <TrashIcon size={14} />
                      </TooltipTrigger>
                      <TooltipContent>{t("action.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="profile-media__group">
          <legend>{t("media.group.audio")}</legend>
          {/* 一行说清「现在挂着哪首」，换和删就摆在名字旁边。名字始终占位，空着的
              时候由文案说明是空的，而不是让整行消失。 */}
          <div className="profile-media-chip-row">
            <span className={audioName ? "profile-media__audio-name" : "profile-media__audio-name profile-media__audio-name--empty"}>
              {audioName ?? t("media.noAudioSelected")}
            </span>
            <input
              ref={audioInputRef}
              className="profile-media__file-input"
              type="file"
              accept={AUDIO_FILE_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                audioUploader.selectFiles(file ? [file] : null);
                event.currentTarget.value = "";
              }}
            />
            <Tooltip>
              <TooltipTrigger render={<Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    className="profile-media__icon-button"
                    aria-label={t("media.selectAudio")}
                    loading={audioBusy}
                    onClick={() => audioInputRef.current?.click()}
                  />}>
                    <UploadIcon size={14} />
              </TooltipTrigger>
              <TooltipContent>{t("media.selectAudio")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button
                  type="button"
                  size="icon-lg"
                  variant="destructive"
                  className="profile-media__icon-button"
                  aria-label={t("action.delete")}
                  disabled={!profileAudioMediaId}
                  onClick={() => void handleRemoveAudio()}
                />}>
                  <TrashIcon size={14} />
              </TooltipTrigger>
              <TooltipContent>{t("action.delete")}</TooltipContent>
            </Tooltip>
          </div>

          <p className="profile-media__hint">{t("media.audioHint")}</p>

          {audioUploader.error ? <p className="profile-media__error" role="alert">{audioUploader.error}</p> : null}
          {renderProgress(audioUploader)}
        </fieldset>
      </div>
    </Card>
  );
}
