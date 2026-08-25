import { AUDIO_FILE_ACCEPT, IMAGE_FILE_ACCEPT } from "@guild/shared";
import { PlusIcon, TrashIcon, UploadIcon, UserIcon } from "@portal/components/icons";
import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import { Avatar, AvatarFallback, AvatarImage } from "@portal/components/ui/avatar";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Progress } from "@portal/components/ui/progress";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { ImageGridEditorItem } from "@portal/types/media";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UseMediaUploadState } from "../../../hooks/useMediaUpload";
import type { UsersListResponse } from "../../../services/UserService";
import { resolveMediaUrl } from "../../../utils/media";
import "./AdminMemberMediaTab.css";

type AdminUserRow = UsersListResponse["data"][number];

type AdminMemberMediaTabProps = {
  member: AdminUserRow;
  isAdmin: boolean;
  isModerator: boolean;
  profileImageQuota: number;
  imageItems: ImageGridEditorItem[];
  imageUploader: UseMediaUploadState<unknown>;
  imageReorderPending: boolean;
  imageDeletePending: boolean;
  onImageReorder: (items: ImageGridEditorItem[]) => void;
  onImageDelete: (item: ImageGridEditorItem) => void;
  onUploadImages: () => Promise<void>;
  videoUrls: string[];
  hasVideoChanges: boolean;
  saveVideosPending: boolean;
  onVideoUrlChange: (index: number, value: string) => void;
  onAddVideoUrl: () => void;
  onRemoveVideoUrl: (index: number) => void;
  onSaveVideoUrls: () => Promise<void>;
  audioUploader: UseMediaUploadState<unknown>;
  deleteAudioPending: boolean;
  onUploadAudio: () => Promise<void>;
  onDeleteAudio: () => void;
  avatarUploadPending: boolean;
  avatarDeletePending: boolean;
  onUploadAvatar: (file: File) => void;
  onDeleteAvatar: () => void;
};

export function AdminMemberMediaTab(props: AdminMemberMediaTabProps) {
  const {
    member,
    isAdmin,
    isModerator,
    profileImageQuota,
    imageItems,
    imageUploader,
    imageReorderPending,
    imageDeletePending,
    onImageReorder,
    onImageDelete,
    onUploadImages,
    videoUrls,
    hasVideoChanges,
    saveVideosPending,
    onVideoUrlChange,
    onAddVideoUrl,
    onRemoveVideoUrl,
    onSaveVideoUrls,
    audioUploader,
    deleteAudioPending,
    onUploadAudio,
    onDeleteAudio,
    avatarUploadPending,
    avatarDeletePending,
    onUploadAvatar,
    onDeleteAvatar,
  } = props;
  const { t } = useTranslation(["admin", "common"]);
  const confirm = useConfirmDialog();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleDeleteAvatar = async () => {
    const confirmed = await confirm({
      title: t("confirm.deleteAvatar.title"),
      description: t("confirm.deleteAvatar.description", { display_name: member.user.display_name }),
      confirmLabel: t("media.removeAvatar"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) onDeleteAvatar();
  };

  const handleDeleteAudio = async () => {
    const confirmed = await confirm({
      title: t("confirm.deleteAudio.title"),
      description: t("confirm.deleteAudio.description", { display_name: member.user.display_name }),
      confirmLabel: t("media.removeAudio"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) onDeleteAudio();
  };

  return (
    <div className="admin-member-media">
      <Card size="sm" className="admin-member-media__card">
        <CardHeader><CardTitle>{t("media.avatar")}</CardTitle></CardHeader>
        <CardContent>
          <div className="admin-member-media__avatar-row">
            <Avatar className="admin-member-media__avatar">
              {member.profile.avatar_media_id ? (
                <AvatarImage src={resolveMediaUrl(member.profile.avatar_media_id)} alt="" />
              ) : null}
              <AvatarFallback><UserIcon size={32} /></AvatarFallback>
            </Avatar>
            {isModerator ? (
              <div className="admin-member-media__action-stack">
                <input
                  ref={avatarInputRef}
                  className="sr-only"
                  type="file"
                  accept={IMAGE_FILE_ACCEPT}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onUploadAvatar(file);
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={avatarUploadPending}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <UploadIcon size={16} data-icon="inline-start" />
                  {t("media.uploadAvatar")}
                </Button>
                {member.profile.avatar_media_id && isAdmin ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    loading={avatarDeletePending}
                    onClick={() => void handleDeleteAvatar()}
                  >
                    <TrashIcon size={14} data-icon="inline-start" />
                    {t("media.removeAvatar")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="admin-member-media__card">
        <CardHeader><CardTitle>{t("media.images")}</CardTitle></CardHeader>
        <CardContent>
          {imageItems.length === 0 && !isModerator ? (
            <p className="admin-member-media__muted">{t("media.noImages")}</p>
          ) : (
            <div className="admin-member-media__section-stack">
              <ImageGridEditor
                items={imageItems}
                onReorder={onImageReorder}
                onDelete={isAdmin ? onImageDelete : undefined}
                onFilesSelected={isModerator ? imageUploader.selectFiles : undefined}
                maxImages={profileImageQuota}
                imageSize={80}
                disabled={imageDeletePending || imageReorderPending}
                aria-label={t("media.aria.profileImagesGrid")}
              />
              {imageUploader.files.length > 0 ? (
                <div className="admin-member-media__upload-stack">
                  {imageUploader.error ? <p className="admin-member-media__error">{imageUploader.error}</p> : null}
                  {imageUploader.isConverting || imageUploader.isUploading ? (
                    <div className="admin-member-media__progress-stack">
                      <Progress value={imageUploader.conversionProgress} />
                      <Progress value={imageUploader.uploadProgress} />
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onUploadImages()}
                    loading={imageUploader.isUploading}
                    disabled={imageUploader.files.length === 0}
                  >
                    <UploadIcon size={16} data-icon="inline-start" />
                    {t("media.uploadImages")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm" className="admin-member-media__card">
        <CardHeader><CardTitle>{t("media.videos")}</CardTitle></CardHeader>
        <CardContent>
          <div className="admin-member-media__section-stack">
            {videoUrls.map((url, index) => (
              <div className="admin-member-media__video-row" key={index}>
                <Input
                  placeholder={t("media.videoUrlPlaceholder")}
                  aria-label={`${t("media.videoUrlPlaceholder")} ${index + 1}`}
                  value={url}
                  onChange={(event) => onVideoUrlChange(index, event.currentTarget.value)}
                  disabled={!isModerator}
                />
                {isModerator ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    onClick={() => onRemoveVideoUrl(index)}
                    loading={saveVideosPending}
                    aria-label={t("media.aria.removeVideoUrl")}
                  >
                    <TrashIcon size={16} />
                  </Button>
                ) : null}
              </div>
            ))}
            {isModerator ? (
              <div className="admin-member-media__actions">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onAddVideoUrl}
                  disabled={videoUrls.length >= 10}
                >
                  <PlusIcon size={16} data-icon="inline-start" />
                  {t("media.addVideoUrl")}
                </Button>
                {hasVideoChanges ? (
                  <Button type="button" size="sm" onClick={() => void onSaveVideoUrls()} loading={saveVideosPending}>
                    {t("media.saveVideoUrls")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {videoUrls.length === 0 && !isModerator ? (
              <p className="admin-member-media__muted">{t("media.noVideos")}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="admin-member-media__card">
        <CardHeader><CardTitle>{t("media.audio")}</CardTitle></CardHeader>
        <CardContent>
          <div className="admin-member-media__section-stack">
            {member.profile.audio_media_id ? (
              <div className="admin-member-media__audio-stack">
                <audio controls preload="metadata" src={resolveMediaUrl(member.profile.audio_media_id, "full")} />
                <span className="admin-member-media__filename">
                  {member.profile.audio_name ?? member.profile.audio_media_id}
                </span>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDeleteAudio()}
                    loading={deleteAudioPending}
                    aria-label={t("media.aria.removeAudio")}
                  >
                    <TrashIcon size={14} data-icon="inline-start" />
                    {t("media.removeAudio")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="admin-member-media__muted">{t("media.noAudio")}</p>
            )}

            {isModerator ? (
              <div className="admin-member-media__upload-stack">
                {audioUploader.error ? <p className="admin-member-media__error">{audioUploader.error}</p> : null}
                {audioUploader.isConverting || audioUploader.isUploading ? (
                  <div className="admin-member-media__progress-stack">
                    <Progress value={audioUploader.conversionProgress} />
                    <Progress value={audioUploader.uploadProgress} />
                  </div>
                ) : null}
                <input
                  ref={audioInputRef}
                  className="sr-only"
                  type="file"
                  accept={AUDIO_FILE_ACCEPT}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) audioUploader.selectFiles([file]);
                    event.currentTarget.value = "";
                  }}
                />
                <div className="admin-member-media__actions">
                  <Button type="button" variant="outline" size="sm" onClick={() => audioInputRef.current?.click()}>
                    <PlusIcon size={14} data-icon="inline-start" />
                    {t("media.selectAudio")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onUploadAudio()}
                    loading={audioUploader.isUploading}
                    disabled={audioUploader.files.length === 0}
                  >
                    <UploadIcon size={14} data-icon="inline-start" />
                    {t("media.uploadAudio")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
