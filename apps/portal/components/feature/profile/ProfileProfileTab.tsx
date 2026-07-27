import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { PortalCard } from "../../shared/PortalCard";
import { FloatingSaveBar } from "../../shared/FloatingSaveBar";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { Avatar, Button, Divider, FileButton, Grid, Group, NumberInput, Progress, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { modals } from "@mantine/modals";
import { ExternalLinkIcon, PlusIcon, TrashIcon, UploadIcon, UserIcon } from "@portal/components/icons";
import { useMemo, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
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

type ProfileProfileTabProps = {
  power: number;
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  titleHtml: string;
  onTitleHtmlChange: (value: string) => void;
  bio: string;
  classSensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  onPowerChange: (value: number) => void;
  onClassDraftChange: (value: string) => void;
  onAddClass: () => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  renderSortableClassRow: (value: string, index: number) => ReactNode;
  onBioChange: (value: string) => void;
  onSaveProfile: () => void;
  savePending: boolean;
  isDirty: boolean;
  fieldBioPlaceholder: string;
  videoDraft: string;
  videoList: string[];
  imageList: string[];
  avatarKey: string | null;
  profileAudioKey: string | null;
  imageUploader: UploaderState;
  audioUploader: UploaderState;
  avatarUploading: boolean;
  onVideoDraftChange: (value: string) => void;
  onAddVideoUrl: () => void;
  onMoveVideo: (index: number, delta: number) => void;
  onRemoveVideo: (index: number) => void;
  onUploadImages: () => void;
  onUploadAudio: () => void;
  onUploadAvatar: (file: File) => void;
  onRemoveAvatar: () => void;
  onReorderImages: (nextImages: string[]) => void;
  onRemoveImage: (key: string) => void;
  onRemoveAudio: () => void;
};

export function ProfileProfileTab({
  power,
  classDraft,
  classOptions,
  classList,
  titleHtml,
  onTitleHtmlChange,
  bio,
  classSensors,
  onPowerChange,
  onClassDraftChange,
  onAddClass,
  onClassDragEnd,
  renderSortableClassRow,
  onBioChange,
  onSaveProfile,
  savePending,
  isDirty,
  fieldBioPlaceholder,
  videoDraft,
  videoList,
  imageList,
  avatarKey,
  profileAudioKey,
  imageUploader,
  audioUploader,
  avatarUploading,
  onVideoDraftChange,
  onAddVideoUrl,
  onMoveVideo,
  onRemoveVideo,
  onUploadImages,
  onUploadAudio,
  onUploadAvatar,
  onRemoveAvatar,
  onReorderImages,
  onRemoveImage,
  onRemoveAudio,
}: ProfileProfileTabProps) {
  const { t } = useTranslation("profile");

  const safeTitleHtml = useMemo(
    () => (titleHtml ? DOMPurify.sanitize(titleHtml) : ""),
    [titleHtml],
  );

  const imageItems: ImageGridEditorItem[] = imageList.map((key) => ({
    id: key,
    src: resolveProfileMediaUrl(key),
    alt: key,
  }));

  return (
    <>
      <Grid gutter="md">
        {/* ── Left Column: Profile Info ── */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PortalCard interactive={false} style={{ height: "100%" }}>
            <Stack gap={0} p="1.2rem">
              <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("section.basicInfo")}</Text>
              <NumberInput
                label={t("field.power")}
                value={power}
                decimalScale={2}
                hideControls
                onChange={(value) => { if (typeof value === "number") onPowerChange(value); }}
              />

              <Divider my={16} />

              <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("section.classes")}</Text>
              <Group gap={8} wrap="nowrap">
                <Select
                  searchable
                  value={classDraft || null}
                  data={classOptions}
                  style={{ flex: 1 }}
                  placeholder={t("field.selectClass")}
                  aria-label={t("aria.selectClass")}
                  onChange={(value) => onClassDraftChange(value ?? "")}
                  onSearchChange={(value) => onClassDraftChange(value)}
                />
                <DepthButton type="primary" onClick={onAddClass} before={<PlusIcon size={16} />}>{t("action.add")}</DepthButton>
              </Group>
              {classList.length > 0 && (
                <DndContext sensors={classSensors} collisionDetection={closestCenter} onDragEnd={onClassDragEnd}>
                  <SortableContext items={classList} strategy={verticalListSortingStrategy}>
                    <Stack gap={6} mt={8}>{classList.map((item, index) => renderSortableClassRow(item, index))}</Stack>
                  </SortableContext>
                </DndContext>
              )}

              <Divider my={16} />

              <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("section.about")}</Text>
              <TextInput
                label={
                  <Group gap={8} align="center" wrap="nowrap" style={{ lineHeight: 1.4 }}>
                    <span>{t("field.titleHtml")}</span>
                    <Text component={Link} to="/tools" size="xs" c="dimmed" td="underline" style={{ cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 2 }}>
                      {t("action.titleGenerator")}<ExternalLinkIcon size={12} />
                    </Text>
                  </Group>
                }
                value={titleHtml}
                onChange={(event) => onTitleHtmlChange(event.currentTarget.value)}
                placeholder={t("field.titleHtml")}
              />
              {titleHtml ? (
                <div style={{ marginTop: 6 }}>
                  <Text c="dimmed" size="xs" mb={4}>{t("field.titlePreview")}</Text>
                  <div dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
                </div>
              ) : null}
              <Textarea
                label={t("field.bio")}
                value={bio}
                onChange={(event) => onBioChange(event.currentTarget.value)}
                minRows={3}
                autosize
                maxRows={8}
                placeholder={fieldBioPlaceholder}
                mt={12}
              />
            </Stack>
          </PortalCard>
        </Grid.Col>

        {/* ── Right Column: Media ── */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PortalCard interactive={false} style={{ height: "100%" }}>
            <Stack gap={0} p="1.2rem">
              <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("media.avatar")}</Text>
              <Group gap={16} align="center">
                <Avatar size={64} radius="xl" src={avatarKey ? resolveProfileMediaUrl(avatarKey) : undefined}
                  className="profile-media-avatar"
                >
                  <UserIcon size={28} />
                </Avatar>
                <Stack gap={4}>
                  <FileButton
                    onChange={(file) => { if (file) onUploadAvatar(file); }}
                    accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                  >
                    {(props) => (
                      <Button variant="default" size="compact-sm" loading={avatarUploading} leftSection={<UploadIcon size={14} />} {...props}>
                        {t("media.uploadAvatar")}
                      </Button>
                    )}
                  </FileButton>
                  {avatarKey ? (
                    <Button variant="subtle" color="red" size="compact-xs" leftSection={<TrashIcon size={12} />}
                      onClick={() => {
                        modals.openConfirmModal({
                          title: t("confirm.removeAvatar.title"),
                          children: t("confirm.removeAvatar.description"),
                          centered: true,
                          confirmProps: { color: "red" },
                          labels: { cancel: t("common:action.cancel"), confirm: t("common:action.delete") },
                          onConfirm: onRemoveAvatar,
                        });
                      }}
                    >
                      {t("media.removeAvatar")}
                    </Button>
                  ) : null}
                </Stack>
              </Group>

              <Divider my={16} />

              <Group justify="space-between" align="center" mb={10}>
                <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5}>{t("media.images")}</Text>
                <Text c="dimmed" size="xs">{t("media.imageCount", { count: imageList.length })}</Text>
              </Group>

              <ImageGridEditor
                items={imageItems}
                onReorder={(items) => onReorderImages(items.map((item) => item.id))}
                onDelete={(item) => {
                  modals.openConfirmModal({
                    title: t("confirm.removeImage.title"),
                    children: t("confirm.removeImage.description"),
                    centered: true,
                    confirmProps: { color: "red" },
                    labels: { cancel: t("common:action.cancel"), confirm: t("common:action.delete") },
                    onConfirm: () => onRemoveImage(item.id),
                  });
                }}
                onFilesSelected={(files) => imageUploader.selectFiles(files)}
                maxImages={10}
                imageSize={80}
                disabled={imageUploader.isUploading || imageUploader.isConverting}
                aria-label={t("media.images")}
              />

              {imageUploader.files.length > 0 ? (
                <Group gap={8} align="center" mt={8}>
                  <Text size="xs" c="dimmed">{t("media.filesSelected", { count: imageUploader.files.length })}</Text>
                  <Button size="compact-sm" onClick={onUploadImages} disabled={imageUploader.files.length === 0}
                    loading={imageUploader.isUploading} leftSection={<UploadIcon size={14} />}
                  >
                    {t("action.upload")}
                  </Button>
                </Group>
              ) : null}

              {imageUploader.error ? <Text c="red" size="sm" mt={4}>{imageUploader.error}</Text> : null}
              {imageUploader.isConverting || imageUploader.isUploading ? (
                <Stack gap={4} mt={6}>
                  <Progress value={imageUploader.conversionProgress} size="xs" animated />
                  <Progress value={imageUploader.uploadProgress} size="xs" animated />
                </Stack>
              ) : null}

              <Divider my={16} />

              <Group justify="space-between" align="center" mb={10}>
                <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5}>{t("media.videos")}</Text>
                <Text c="dimmed" size="xs">{t("media.videoCount", { count: videoList.length })}</Text>
              </Group>

              <Group gap={8} wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  value={videoDraft}
                  onChange={(event) => onVideoDraftChange(event.currentTarget.value)}
                  placeholder="https://youtube.com/..."
                  onKeyDown={(event) => { if (event.key === "Enter") onAddVideoUrl(); }}
                />
                <Button size="compact-sm" onClick={onAddVideoUrl} leftSection={<PlusIcon size={14} />}>{t("action.add")}</Button>
              </Group>
              <Text c="dimmed" size="xs" mt={4}>{t("media.videoHostHint")}</Text>

              {videoList.length > 0 ? (
                <Stack gap={6} mt={10}>
                  {videoList.map((item, index) => (
                    <Group key={`${item}-${index}`} gap={8} wrap="wrap" align="center"
                      className="profile-media-chip-row"
                    >
                      <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate="end">{item}</Text>
                      <Group gap={4} wrap="nowrap">
                        <Button size="compact-xs" variant="default" onClick={() => onMoveVideo(index, -1)} disabled={index === 0}>{t("action.up")}</Button>
                        <Button size="compact-xs" variant="default" onClick={() => onMoveVideo(index, 1)} disabled={index === videoList.length - 1}>{t("action.down")}</Button>
                        <DepthButton size="sm" type="danger" iconOnly before={<TrashIcon size={14} />} onClick={() => onRemoveVideo(index)} tooltip={{ label: t("action.delete"), withArrow: true }} />
                      </Group>
                    </Group>
                  ))}
                </Stack>
              ) : null}

              <Divider my={16} />

              <Group justify="space-between" align="center" mb={10}>
                <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5}>{t("media.audio")}</Text>
                <Text c="dimmed" size="xs">{profileAudioKey ? t("media.audioUploaded") : t("media.noAudio")}</Text>
              </Group>

              <Group gap={8} align="center">
                <FileButton
                  onChange={(files) => audioUploader.selectFiles(files ? [files] : null)}
                  accept="audio/ogg,audio/webm,audio/mp4,audio/mpeg,audio/wav"
                >
                  {(props) => (
                    <Button variant="default" size="compact-sm" {...props}>{t("media.selectAudio")}</Button>
                  )}
                </FileButton>
                {audioUploader.files.length > 0 ? (
                  <Text size="xs" c="dimmed">{audioUploader.files[0]?.name}</Text>
                ) : null}
                <Button size="compact-sm" onClick={onUploadAudio} disabled={audioUploader.files.length === 0}
                  loading={audioUploader.isUploading} leftSection={<UploadIcon size={14} />}
                >
                  {t("action.upload")}
                </Button>
              </Group>

              {audioUploader.error ? <Text c="red" size="sm" mt={4}>{audioUploader.error}</Text> : null}
              {audioUploader.isConverting || audioUploader.isUploading ? (
                <Stack gap={4} mt={6}>
                  <Progress value={audioUploader.conversionProgress} size="xs" animated />
                  <Progress value={audioUploader.uploadProgress} size="xs" animated />
                </Stack>
              ) : null}

              {profileAudioKey ? (
                <Group gap={8} align="center" mt={8}
                  className="profile-media-chip-row"
                >
                  <Text size="sm" style={{ flex: 1 }} truncate="end">{profileAudioKey.split("/").pop()}</Text>
                  <DepthButton size="sm" type="danger" iconOnly before={<TrashIcon size={14} />} onClick={() => {
                    modals.openConfirmModal({
                      title: t("confirm.removeAudio.title"),
                      children: t("confirm.removeAudio.description"),
                      centered: true,
                      confirmProps: { color: "red" },
                      labels: { cancel: t("common:action.cancel"), confirm: t("common:action.delete") },
                      onConfirm: onRemoveAudio,
                    });
                  }} tooltip={{ label: t("action.delete"), withArrow: true }} />
                </Group>
              ) : null}
            </Stack>
          </PortalCard>
        </Grid.Col>
      </Grid>
      <FloatingSaveBar isDirty={isDirty} saving={savePending} onSave={onSaveProfile} />
    </>
  );
}
