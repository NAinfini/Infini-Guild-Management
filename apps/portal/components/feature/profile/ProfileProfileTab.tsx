import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { Button, Group, NumberInput, Progress, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import type { ReactNode } from "react";

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
  wechatName: string;
  power: number;
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  videoDraft: string;
  videoList: string[];
  imageList: string[];
  profileAudioKey: string | null;
  discordId: string | null;
  titleEditor: ReactNode;
  bio: string;
  imageUploader: UploaderState;
  audioUploader: UploaderState;
  classSensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  onWechatNameChange: (value: string) => void;
  onPowerChange: (value: number) => void;
  onClassDraftChange: (value: string) => void;
  onAddClass: () => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  renderSortableClassRow: (value: string, index: number) => ReactNode;
  onVideoDraftChange: (value: string) => void;
  onAddVideoUrl: () => void;
  onMoveVideo: (index: number, delta: number) => void;
  onRemoveVideo: (index: number) => void;
  onBioChange: (value: string) => void;
  onSaveProfile: () => void;
  onUploadImages: () => void;
  onUploadAudio: () => void;
  onMoveImage: (index: number, delta: number) => void;
  onRemoveImage: (key: string) => void;
  onRemoveAudio: () => void;
  fieldBioPlaceholder: string;
  buttonUploadImagesLabel: string;
  buttonUploadAudioLabel: string;
};

export function ProfileProfileTab({
  wechatName,
  power,
  classDraft,
  classOptions,
  classList,
  videoDraft,
  videoList,
  imageList,
  profileAudioKey,
  discordId,
  titleEditor,
  bio,
  imageUploader,
  audioUploader,
  classSensors,
  onWechatNameChange,
  onPowerChange,
  onClassDraftChange,
  onAddClass,
  onClassDragEnd,
  renderSortableClassRow,
  onVideoDraftChange,
  onAddVideoUrl,
  onMoveVideo,
  onRemoveVideo,
  onBioChange,
  onSaveProfile,
  onUploadImages,
  onUploadAudio,
  onMoveImage,
  onRemoveImage,
  onRemoveAudio,
  fieldBioPlaceholder,
  buttonUploadImagesLabel,
  buttonUploadAudioLabel,
}: ProfileProfileTabProps) {
  return (
    <Stack gap={12}>
      <TextInput value={wechatName} onChange={(event) => onWechatNameChange(event.currentTarget.value)} placeholder="WeChat" />
      <NumberInput value={power} onChange={(value) => onPowerChange(typeof value === "number" ? value : 0)} />

      <InfiniCard>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>Classes</Text>
            <Group gap={0} wrap="nowrap">
              <Select
                searchable
                value={classDraft || null}
                data={classOptions}
                style={{ minWidth: 200 }}
                placeholder="Select class"
                aria-label="Select class"
                onChange={(value) => onClassDraftChange(value ?? "")}
                onSearchChange={(value) => onClassDraftChange(value)}
              />
              <Button onClick={onAddClass}>Add</Button>
            </Group>
            <DndContext sensors={classSensors} collisionDetection={closestCenter} onDragEnd={onClassDragEnd}>
              <SortableContext items={classList} strategy={verticalListSortingStrategy}>
                <Stack gap={6}>{classList.map((item, index) => renderSortableClassRow(item, index))}</Stack>
              </SortableContext>
            </DndContext>
          </Stack>
        </div>
      </InfiniCard>

      <InfiniCard>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>Video URLs</Text>
            <Group gap={0} wrap="nowrap">
              <TextInput
                value={videoDraft}
                onChange={(event) => onVideoDraftChange(event.currentTarget.value)}
                placeholder="https://youtube.com/..."
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onAddVideoUrl();
                  }
                }}
              />
              <Button onClick={onAddVideoUrl}>Add</Button>
            </Group>
            {videoList.map((item, index) => (
              <Group key={`${item}-${index}`} gap={8} wrap="wrap">
                <Text style={{ maxWidth: 420 }} truncate="end">
                  {item}
                </Text>
                <Button size="xs" onClick={() => onMoveVideo(index, -1)} disabled={index === 0}>
                  Up
                </Button>
                <Button size="xs" onClick={() => onMoveVideo(index, 1)} disabled={index === videoList.length - 1}>
                  Down
                </Button>
                <Button size="xs" color="red" onClick={() => onRemoveVideo(index)}>
                  Remove
                </Button>
              </Group>
            ))}
          </Stack>
        </div>
      </InfiniCard>

      {titleEditor}
      <Textarea value={bio} onChange={(event) => onBioChange(event.currentTarget.value)} minRows={4} placeholder={fieldBioPlaceholder} />
      <MotionButton type="primary" onClick={onSaveProfile}>
        Save Profile
      </MotionButton>

      <Text>{buttonUploadImagesLabel}</Text>
      <input
        type="file"
        multiple
        accept="image/*"
        aria-label="Select profile images"
        onChange={(event) => imageUploader.selectFiles(event.target.files)}
      />
      {imageUploader.error ? <Text c="red">{imageUploader.error}</Text> : null}
      {imageUploader.isConverting || imageUploader.isUploading ? (
        <Stack style={{ width: "100%" }}>
          <Progress value={imageUploader.conversionProgress} size="sm" animated />
          <Progress value={imageUploader.uploadProgress} size="sm" animated />
        </Stack>
      ) : null}
      <Button onClick={onUploadImages} disabled={imageUploader.files.length === 0} loading={imageUploader.isUploading}>
        Upload Images
      </Button>

      <Text>{buttonUploadAudioLabel}</Text>
      <Text c="dimmed" size="sm">
        Audio is converted to Opus/Ogg before upload (48kbps, 16kHz, mono).
      </Text>
      {audioUploader.supportError ? (
        <Text c="yellow" size="sm">
          {audioUploader.supportError}
        </Text>
      ) : null}
      <input
        type="file"
        accept="audio/*"
        aria-label="Select profile audio"
        disabled={Boolean(audioUploader.supportError)}
        onChange={(event) => audioUploader.selectFiles(event.target.files)}
      />
      {audioUploader.error ? <Text c="red">{audioUploader.error}</Text> : null}
      {audioUploader.isConverting || audioUploader.isUploading ? (
        <Stack style={{ width: "100%" }}>
          <Progress value={audioUploader.conversionProgress} size="sm" animated />
          <Progress value={audioUploader.uploadProgress} size="sm" animated />
        </Stack>
      ) : null}
      <Button
        onClick={onUploadAudio}
        disabled={Boolean(audioUploader.supportError) || audioUploader.files.length === 0}
        loading={audioUploader.isUploading}
      >
        Upload Audio
      </Button>

      <InfiniCard>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>Current Images</Text>
            <Text>{imageList.length} image(s)</Text>
            {imageList.map((imageKey, index) => (
              <Group key={`${imageKey}-${index}`} gap={8} wrap="wrap">
                <Text style={{ maxWidth: 300 }} truncate="end">
                  {imageKey}
                </Text>
                <Button size="xs" onClick={() => onMoveImage(index, -1)} disabled={index === 0}>
                  Up
                </Button>
                <Button size="xs" onClick={() => onMoveImage(index, 1)} disabled={index === imageList.length - 1}>
                  Down
                </Button>
                <Button size="xs" color="red" onClick={() => onRemoveImage(imageKey)}>
                  Delete
                </Button>
              </Group>
            ))}
          </Stack>
        </div>
      </InfiniCard>

      <Text>Current audio key: {profileAudioKey ?? "-"}</Text>
      <Button color="red" onClick={onRemoveAudio} disabled={!profileAudioKey}>
        Delete Audio
      </Button>
      <Text>Discord ID: {discordId ?? "-"}</Text>
    </Stack>
  );
}
