import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  deleteProfileAudio,
  deleteProfileImage,
  updateMyProfile,
  uploadProfileAudio,
  uploadProfileImages,
} from "../../../api/mutations/users";
import { fetchUsersList } from "../../../api/queries/users";
import { useMediaUpload } from "../../../hooks/useMediaUpload";

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

  const imageUploader = useMediaUpload(
    async (files) => uploadProfileImages(member.user.id, files),
    {
      maxFiles: 10,
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
        throw new Error("Audio file is required");
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
      notifications.show({ color: "green", message: "Image removed" });
      await onRefresh();
    },
    onError: (error) => onError(error, "Failed to remove image"),
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => deleteProfileAudio(member.user.id),
    onSuccess: async () => {
      notifications.show({ color: "green", message: "Audio removed" });
      await onRefresh();
    },
    onError: (error) => onError(error, "Failed to remove audio"),
  });

  const removeVideoMutation = useMutation({
    mutationFn: (videoUrl: string) =>
      updateMyProfile(member.user.id, {
        video_urls: member.profile.video_urls.filter((item) => item !== videoUrl),
      }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: "Video removed" });
      await onRefresh();
    },
    onError: (error) => onError(error, "Failed to remove video"),
  });

  const handleImageUpload = async () => {
    try {
      const result = await imageUploader.upload();
      if (!result) {
        return;
      }
      notifications.show({ color: "green", message: "Images uploaded" });
      await onRefresh();
      imageUploader.reset();
    } catch (error) {
      onError(error, "Failed to upload images");
    }
  };

  const handleAudioUpload = async () => {
    try {
      const result = await audioUploader.upload();
      if (!result) {
        return;
      }
      notifications.show({ color: "green", message: "Audio uploaded" });
      await onRefresh();
      audioUploader.reset();
    } catch (error) {
      onError(error, "Failed to upload audio");
    }
  };

  return (
    <Stack gap={12}>
      <Text fw={600}>Images</Text>
      {member.profile.images.length === 0 ? (
        <Text c="dimmed" size="sm">No profile images</Text>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="grid" aria-label="Profile images">
          {member.profile.images.map((key, index) => (
            <div
              key={key}
              role="gridcell"
              style={{
                width: 64,
                position: "relative",
              }}
            >
              {isHttpUrl(key) ? (
                <img
                  src={key}
                  alt={`Profile image ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "cover",
                    borderRadius: 8,
                    display: "block",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 8,
                    border: "1px solid color-mix(in srgb, var(--infini-color-text, #111827) 22%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 6,
                    textAlign: "center",
                  }}
                >
                  <Text size="10px" c="dimmed">
                    R2 key
                  </Text>
                </div>
              )}
              {isAdmin ? (
                <Button
                  size="xs"
                  color="red"
                  style={{ position: "absolute", top: 2, right: 2, paddingInline: 6 }}
                  onClick={() => deleteImageMutation.mutate(key)}
                  loading={deleteImageMutation.isPending}
                  aria-label={`Delete image ${index + 1}`}
                >
                  x
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Text fw={600}>Videos</Text>
      {member.profile.video_urls.length === 0 ? (
        <Text c="dimmed" size="sm">No videos</Text>
      ) : (
        <Stack gap={6}>
          {member.profile.video_urls.map((videoUrl) => (
            <Group key={videoUrl} wrap="wrap">
              <Text style={{ wordBreak: "break-all" }}>{videoUrl}</Text>
              {isAdmin ? (
                <Button
                  size="xs"
                  color="red"
                  onClick={() => removeVideoMutation.mutate(videoUrl)}
                  loading={removeVideoMutation.isPending}
                  aria-label="Remove video URL"
                >
                  Remove
                </Button>
              ) : null}
            </Group>
          ))}
        </Stack>
      )}

      <Text fw={600}>Audio</Text>
      {member.profile.audio_key ? (
        <Stack gap={6}>
          <audio controls src={member.profile.audio_key} style={{ width: "100%" }} />
          <Text c="dimmed" size="sm" style={{ wordBreak: "break-all" }}>
            {member.profile.audio_key}
          </Text>
          {isAdmin ? (
            <Button
              color="red"
              onClick={() => deleteAudioMutation.mutate()}
              loading={deleteAudioMutation.isPending}
              aria-label="Remove profile audio"
            >
              Remove Audio
            </Button>
          ) : null}
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">No audio uploaded</Text>
      )}

      {isModerator ? (
        <>
          <InfiniCard>
            <div style={{ padding: "1.2rem" }}>
              <Text fw={600} size="sm" mb={8}>Upload Images</Text>
              <Stack gap={8}>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  aria-label="Select profile images for upload"
                  onChange={(event) => imageUploader.selectFiles(event.target.files)}
                />
                {imageUploader.error ? <Text c="red" size="sm">{imageUploader.error}</Text> : null}
                {imageUploader.isConverting || imageUploader.isUploading ? (
                  <Stack style={{ width: "100%" }} gap={4}>
                    <Progress value={imageUploader.conversionProgress} size="sm" animated />
                    <Progress value={imageUploader.uploadProgress} size="sm" animated />
                  </Stack>
                ) : null}
                <Button
                  onClick={handleImageUpload}
                  loading={imageUploader.isUploading}
                  disabled={imageUploader.files.length === 0}
                >
                  Upload Images
                </Button>
              </Stack>
            </div>
          </InfiniCard>

          <InfiniCard>
            <div style={{ padding: "1.2rem" }}>
              <Text fw={600} size="sm" mb={8}>Upload Audio</Text>
              <Stack gap={8}>
                <Text c="dimmed" size="sm">Audio is converted to Opus/Ogg (48kbps, 16kHz, mono) before upload.</Text>
                {audioUploader.supportError ? (
                  <Text c="yellow" size="sm">{audioUploader.supportError}</Text>
                ) : null}
                <input
                  type="file"
                  accept="audio/*"
                  aria-label="Select profile audio for upload"
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
                  onClick={handleAudioUpload}
                  loading={audioUploader.isUploading}
                  disabled={Boolean(audioUploader.supportError) || audioUploader.files.length === 0}
                >
                  Upload Audio
                </Button>
              </Stack>
            </div>
          </InfiniCard>
        </>
      ) : null}
    </Stack>
  );
}

