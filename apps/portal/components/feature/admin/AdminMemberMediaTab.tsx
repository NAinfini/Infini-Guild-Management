import { InfiniCard, type ImageGridEditorItem } from "@infini-dev-kit/frontend/components";
import { ImageGridEditor } from "@infini-dev-kit/frontend/components";
import { Button, Group, Progress, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteProfileAudio,
  deleteProfileImage,
  updateMyProfile,
  uploadProfileAudio,
  uploadProfileImages,
} from "../../../api/mutations/users";
import { fetchUsersList } from "../../../api/queries/users";
import { useMediaUpload } from "../../../hooks/useMediaUpload";

const PROFILE_IMAGE_MAX = 10;
const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_AUDIO_MAX_BYTES = 20 * 1024 * 1024;

type AdminUserRow = Awaited<ReturnType<typeof fetchUsersList>>["data"][number];

type AdminMemberMediaTabProps = {
  member: AdminUserRow;
  isAdmin: boolean;
  isModerator: boolean;
  onRefresh: () => Promise<void>;
  onError: (error: unknown, fallbackMessage: string) => void;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function AdminMemberMediaTab(props: AdminMemberMediaTabProps) {
  const { member, isAdmin, isModerator, onRefresh, onError } = props;
  const { t } = useTranslation(["admin", "common"]);

  // Convert member images to ImageGridEditorItem[]
  const imageItems: ImageGridEditorItem[] = useMemo(
    () =>
      member.profile.images.map((key) => ({
        id: key,
        src: isHttpUrl(key) ? key : undefined,
        alt: key,
      })),
    [member.profile.images],
  );

  const imageUploader = useMediaUpload(
    async (files) => uploadProfileImages(member.user.id, files),
    {
      maxFiles: PROFILE_IMAGE_MAX,
      maxFileSizeBytes: PROFILE_IMAGE_MAX_BYTES,
      mediaType: "image",
      convertImagesToWebp: true,
      imageWebpQuality: 0.8,
    },
  );

  const audioUploader = useMediaUpload(
    async (files) => {
      const file = files[0];
      if (!file) {
        throw new Error(t("media.audioFileRequired"));
      }
      return uploadProfileAudio(member.user.id, file);
    },
    {
      maxFiles: 1,
      maxFileSizeBytes: PROFILE_AUDIO_MAX_BYTES,
      mediaType: "audio",
      convertAudioToOpus: true,
    },
  );

  const deleteImageMutation = useMutation({
    mutationFn: (key: string) => deleteProfileImage(member.user.id, key),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.mediaImageRemoved") });
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaImageRemoveFailed")),
  });

  const reorderImagesMutation = useMutation({
    mutationFn: (newOrder: string[]) =>
      updateMyProfile(member.user.id, { images: newOrder }),
    onSuccess: async () => {
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaImageReorderFailed")),
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => deleteProfileAudio(member.user.id),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.mediaAudioRemoved") });
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAudioRemoveFailed")),
  });

  // Local state for editable video URL list
  const [videoUrls, setVideoUrls] = useState<string[]>(() => [...member.profile.video_urls]);

  // Sync when member data refreshes (e.g. after save)
  useEffect(() => {
    setVideoUrls([...member.profile.video_urls]);
  }, [member.profile.video_urls]);

  const saveVideosMutation = useMutation({
    mutationFn: (urls: string[]) =>
      updateMyProfile(member.user.id, {
        video_urls: urls.filter((u) => u.trim() !== ""),
      }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.mediaVideosSaved") });
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaVideosSaveFailed")),
  });

  const handleImageReorder = useCallback(
    (items: ImageGridEditorItem[]) => {
      const newOrder = items.map((item) => item.id);
      reorderImagesMutation.mutate(newOrder);
    },
    [reorderImagesMutation],
  );

  const handleImageDelete = useCallback(
    (item: ImageGridEditorItem) => {
      deleteImageMutation.mutate(item.id);
    },
    [deleteImageMutation],
  );

  const handleImageSelectFiles = useCallback(
    (files: File[]) => {
      imageUploader.selectFiles(files);
    },
    [imageUploader],
  );

  const handleImageUpload = async () => {
    try {
      const result = await imageUploader.upload();
      if (!result) {
        return;
      }
      notifications.show({ color: "infini-success", message: t("message.mediaImagesUploaded") });
      await onRefresh();
      imageUploader.reset();
    } catch (error) {
      onError(error, t("message.mediaImagesUploadFailed"));
    }
  };

  const handleAudioUpload = async () => {
    try {
      const result = await audioUploader.upload();
      if (!result) {
        return;
      }
      notifications.show({ color: "infini-success", message: t("message.mediaAudioUploaded") });
      await onRefresh();
      audioUploader.reset();
    } catch (error) {
      onError(error, t("message.mediaAudioUploadFailed"));
    }
  };

  return (
    <Stack gap={16}>
      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Text fw={600} size="sm" mb={12}>{t("media.images")}</Text>
          {imageItems.length === 0 && !isModerator ? (
            <Text c="dimmed" size="sm">{t("media.noImages")}</Text>
          ) : (
            <Stack gap={12}>
              <ImageGridEditor
                items={imageItems}
                onReorder={handleImageReorder}
                onDelete={isAdmin ? handleImageDelete : undefined}
                onSelectFiles={isModerator ? handleImageSelectFiles : undefined}
                maxImages={PROFILE_IMAGE_MAX}
                imageSize={80}
                disabled={deleteImageMutation.isPending || reorderImagesMutation.isPending}
                aria-label={t("media.aria.profileImagesGrid")}
              />

              {imageUploader.files.length > 0 ? (
                <Stack gap={8}>
                  {imageUploader.error ? <Text c="infini-danger" size="sm">{imageUploader.error}</Text> : null}
                  {imageUploader.isConverting || imageUploader.isUploading ? (
                    <Stack style={{ width: "100%" }} gap={4}>
                      <Progress value={imageUploader.conversionProgress} size="sm" animated />
                      <Progress value={imageUploader.uploadProgress} size="sm" animated />
                    </Stack>
                  ) : null}
                  <Button
                    leftSection={<IconUpload size={16} />}
                    onClick={handleImageUpload}
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
      </InfiniCard>

      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Text fw={600} size="sm" mb={12}>{t("media.videos")}</Text>
          <Stack gap={8}>
            {videoUrls.map((url, index) => (
              <Group key={index} gap={8} wrap="nowrap" align="flex-end">
                <TextInput
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => {
                    const next = [...videoUrls];
                    next[index] = e.currentTarget.value;
                    setVideoUrls(next);
                  }}
                  style={{ flex: 1 }}
                  size="sm"
                  disabled={!isModerator}
                />
                {isModerator ? (
                  <Button
                    size="sm"
                    color="infini-danger"
                    variant="light"
                    px={8}
                    onClick={() => {
                      const next = videoUrls.filter((_, i) => i !== index);
                      setVideoUrls(next);
                      // Auto-save the removal
                      saveVideosMutation.mutate(next);
                    }}
                    loading={saveVideosMutation.isPending}
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
                  onClick={() => setVideoUrls([...videoUrls, ""])}
                  disabled={videoUrls.length >= 10}
                >
                  {t("media.addVideoUrl")}
                </Button>
                {/* Show save only when local state differs from server */}
                {JSON.stringify(videoUrls) !== JSON.stringify(member.profile.video_urls) ? (
                  <Button
                    size="sm"
                    onClick={() => saveVideosMutation.mutate(videoUrls)}
                    loading={saveVideosMutation.isPending}
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
      </InfiniCard>

      <InfiniCard interactive={false}>
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
                  color="infini-danger"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => deleteAudioMutation.mutate()}
                  loading={deleteAudioMutation.isPending}
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
                <Text c="infini-warning" size="sm">{audioUploader.supportError}</Text>
              ) : null}
              <input
                type="file"
                accept="audio/*"
                aria-label={t("media.aria.selectAudio")}
                disabled={Boolean(audioUploader.supportError)}
                onChange={(event) => audioUploader.selectFiles(event.target.files)}
              />
              {audioUploader.error ? <Text c="infini-danger" size="sm">{audioUploader.error}</Text> : null}
              {audioUploader.isConverting || audioUploader.isUploading ? (
                <Stack style={{ width: "100%" }} gap={4}>
                  <Progress value={audioUploader.conversionProgress} size="sm" animated />
                  <Progress value={audioUploader.uploadProgress} size="sm" animated />
                </Stack>
              ) : null}
              <Button
                leftSection={<IconUpload size={16} />}
                onClick={handleAudioUpload}
                loading={audioUploader.isUploading}
                disabled={Boolean(audioUploader.supportError) || audioUploader.files.length === 0}
                size="sm"
              >
                {t("media.uploadAudio")}
              </Button>
            </Stack>
          ) : null}
        </div>
      </InfiniCard>
    </Stack>
  );
}
