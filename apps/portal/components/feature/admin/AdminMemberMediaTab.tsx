import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@guild/shared/types/media";
import { PortalCard } from "../../shared/PortalCard";
import { Button, Group, Progress, Stack, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { UseMediaUploadState } from "../../../hooks/useMediaUpload";
import type { UsersListResponse } from "../../../services/UserService";

const PROFILE_IMAGE_MAX = 10;

type AdminUserRow = UsersListResponse["data"][number];

type AdminMemberMediaTabProps = {
  member: AdminUserRow;
  isAdmin: boolean;
  isModerator: boolean;
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
};

export function AdminMemberMediaTab(props: AdminMemberMediaTabProps) {
  const {
    member,
    isAdmin,
    isModerator,
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
  } = props;
  const { t } = useTranslation(["admin", "common"]);

  return (
    <Stack gap={16}>
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Text fw={600} size="sm" mb={12}>{t("media.images")}</Text>
          {imageItems.length === 0 && !isModerator ? (
            <Text c="dimmed" size="sm">{t("media.noImages")}</Text>
          ) : (
            <Stack gap={12}>
              <ImageGridEditor
                items={imageItems}
                onReorder={onImageReorder}
                onDelete={isAdmin ? onImageDelete : undefined}
                onFilesSelected={isModerator ? imageUploader.selectFiles : undefined}
                maxImages={PROFILE_IMAGE_MAX}
                imageSize={80}
                disabled={imageDeletePending || imageReorderPending}
                aria-label={t("media.aria.profileImagesGrid")}
              />

              {imageUploader.files.length > 0 ? (
                <Stack gap={8}>
                  {imageUploader.error ? <Text c="red" size="sm">{imageUploader.error}</Text> : null}
                  {imageUploader.isConverting || imageUploader.isUploading ? (
                    <Stack style={{ width: "100%" }} gap={4}>
                      <Progress value={imageUploader.conversionProgress} size="sm" animated />
                      <Progress value={imageUploader.uploadProgress} size="sm" animated />
                    </Stack>
                  ) : null}
                  <Button
                    leftSection={<IconUpload size={16} />}
                    onClick={() => {
                      void onUploadImages();
                    }}
                    loading={imageUploader.isUploading}
                    disabled={imageUploader.files.length === 0}
                    size="sm"
                  >
                    {t("media.uploadImages")}
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          )}
        </div>
      </PortalCard>

      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Text fw={600} size="sm" mb={12}>{t("media.videos")}</Text>
          <Stack gap={8}>
            {videoUrls.map((url, index) => (
              <Group key={index} gap={8} wrap="nowrap" align="flex-end">
                <TextInput
                  placeholder={t("media.videoUrlPlaceholder")}
                  value={url}
                  onChange={(event) => onVideoUrlChange(index, event.currentTarget.value)}
                  style={{ flex: 1 }}
                  size="sm"
                  disabled={!isModerator}
                />
                {isModerator ? (
                  <Button
                    size="sm"
                    color="red"
                    variant="light"
                    px={8}
                    onClick={() => {
                      onRemoveVideoUrl(index);
                    }}
                    loading={saveVideosPending}
                    aria-label={t("media.aria.removeVideoUrl")}
                  >
                    <IconTrash size={16} />
                  </Button>
                ) : null}
              </Group>
            ))}

            {isModerator ? (
              <Group gap={8}>
                <Button
                  size="sm"
                  variant="light"
                  leftSection={<IconPlus size={16} />}
                  onClick={onAddVideoUrl}
                  disabled={videoUrls.length >= 10}
                >
                  {t("media.addVideoUrl")}
                </Button>
                {hasVideoChanges ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      void onSaveVideoUrls();
                    }}
                    loading={saveVideosPending}
                  >
                    {t("media.saveVideoUrls")}
                  </Button>
                ) : null}
              </Group>
            ) : null}

            {videoUrls.length === 0 && !isModerator ? (
              <Text c="dimmed" size="sm">{t("media.noVideos")}</Text>
            ) : null}
          </Stack>
        </div>
      </PortalCard>

      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Text fw={600} size="sm" mb={12}>{t("media.audio")}</Text>
          {member.profile.audio_key ? (
            <Stack gap={6}>
              <audio controls src={member.profile.audio_key} style={{ width: "100%" }} />
              <Text c="dimmed" size="sm" style={{ wordBreak: "break-all" }}>
                {member.profile.audio_key}
              </Text>
              {isAdmin ? (
                <Button
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={() =>
                    modals.openConfirmModal({
                      title: t("confirm.deleteAudio.title"),
                      children: <Text size="sm">{t("confirm.deleteAudio.description")}</Text>,
                      labels: { confirm: t("media.removeAudio"), cancel: t("common:cancel") },
                      confirmProps: { color: "red" },
                      onConfirm: onDeleteAudio,
                    })
                  }
                  loading={deleteAudioPending}
                  aria-label={t("media.aria.removeAudio")}
                >
                  {t("media.removeAudio")}
                </Button>
              ) : null}
            </Stack>
          ) : (
            <Text c="dimmed" size="sm">{t("media.noAudio")}</Text>
          )}

          {isModerator ? (
            <Stack gap={8} mt="md">
              <Text c="dimmed" size="sm">{t("media.uploadAudioHint")}</Text>
              {audioUploader.supportError ? (
                <Text c="yellow" size="sm">{audioUploader.supportError}</Text>
              ) : null}
              <input
                type="file"
                accept="audio/*"
                aria-label={t("media.aria.selectAudio")}
                disabled={Boolean(audioUploader.supportError)}
                onChange={(event) => audioUploader.selectFiles(event.target.files)}
              />
              {audioUploader.error ? <Text c="red" size="sm">{audioUploader.error}</Text> : null}
              {audioUploader.isConverting || audioUploader.isUploading ? (
                <Stack style={{ width: "100%" }} gap={4}>
                  <Progress value={audioUploader.conversionProgress} size="sm" animated />
                  <Progress value={audioUploader.uploadProgress} size="sm" animated />
                </Stack>
              ) : null}
              <Button
                leftSection={<IconUpload size={16} />}
                onClick={() => {
                  void onUploadAudio();
                }}
                loading={audioUploader.isUploading}
                disabled={Boolean(audioUploader.supportError) || audioUploader.files.length === 0}
                size="sm"
              >
                {t("media.uploadAudio")}
              </Button>
            </Stack>
          ) : null}
        </div>
      </PortalCard>
    </Stack>
  );
}
