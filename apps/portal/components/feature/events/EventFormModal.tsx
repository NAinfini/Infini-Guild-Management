import type { Event } from "@guild/shared";
import { EVENT_TYPES } from "@guild/shared";
import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconX, IconPlus, IconDeviceFloppy } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { ImageGridEditor, type ImageGridEditorItem } from "@infini-dev-kit/react";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

type EventFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  canManage: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  eventType: (typeof EVENT_TYPES)[number];
  onEventTypeChange: (value: (typeof EVENT_TYPES)[number]) => void;
  startAt: string;
  onStartAtChange: (value: string) => void;
  endAt: string;
  onEndAtChange: (value: string) => void;
  capacity: string;
  onCapacityChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  attachmentItems: ImageGridEditorItem[];
  onAttachmentsChange: (items: ImageGridEditorItem[]) => void;
  onFilesSelected: (files: File[]) => void;
  onAttachmentDelete: (item: ImageGridEditorItem) => void;
  conflictingEvents: Event[];
  availabilityDaysWithAny: Set<number>;
  availabilityMaxCount: number;
  availabilityMemberCount: number;
  confirmLoading: boolean;
  onCancel: () => void;
  onSave: () => void;
};

export function EventFormModal({
  open,
  mode,
  canManage,
  title,
  onTitleChange,
  eventType,
  onEventTypeChange,
  startAt,
  onStartAtChange,
  endAt,
  onEndAtChange,
  capacity,
  onCapacityChange,
  description,
  onDescriptionChange,
  attachmentItems,
  onAttachmentsChange,
  onFilesSelected,
  onAttachmentDelete,
  conflictingEvents,
  availabilityDaysWithAny,
  availabilityMaxCount,
  availabilityMemberCount,
  confirmLoading,
  onCancel,
  onSave,
}: EventFormModalProps) {
  const { t } = useTranslation("events");

  return (
    <Modal
      title={mode === "create" ? t("modal.createTitle") : t("modal.editTitle")}
      opened={open}
      onClose={onCancel}
      closeOnClickOutside={false}
      closeOnEscape
      centered
      size="lg"
    >
      <Stack gap={16}>
        {/* ── Title ── */}
        <TextInput
          label={t("field.title")}
          value={title}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          placeholder={t("field.title")}
          data-autofocus
        />

        {/* ── Type ── */}
        <Select
          label={t("filter.type")}
          value={eventType}
          onChange={(value) => value && onEventTypeChange(value as (typeof EVENT_TYPES)[number])}
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
        />

        {/* ── Date & Time ── */}
        <Group grow wrap="wrap">
          <TextInput
            label={t("field.start")}
            type="datetime-local"
            value={startAt}
            onChange={(event) => onStartAtChange(event.currentTarget.value)}
          />
          <TextInput
            label={t("field.end")}
            type="datetime-local"
            value={endAt}
            onChange={(event) => onEndAtChange(event.currentTarget.value)}
            error={startAt && endAt && endAt < startAt ? t("field.endBeforeStart") : undefined}
          />
        </Group>

        {/* ── Capacity ── */}
        <TextInput
          label={t("field.capacity")}
          type="number"
          min={1}
          max={9999}
          value={capacity}
          onChange={(event) => onCapacityChange(event.currentTarget.value)}
          placeholder={t("field.unlimited")}
          maw={200}
        />

        {/* ── Description ── */}
        <Textarea
          label={t("field.description")}
          value={description}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
          minRows={3}
          placeholder={t("field.description")}
        />

        {/* ── Attachments ── */}
        <Stack gap={6}>
          <Text size="sm" fw={500}>{t("field.attachmentsCount", { current: attachmentItems.length, max: 5 })}</Text>
          <ImageGridEditor
            items={attachmentItems}
            onReorder={onAttachmentsChange}
            onDelete={canManage ? onAttachmentDelete : undefined}
            onFilesSelected={canManage ? onFilesSelected : undefined}
            maxImages={5}
            disabled={!canManage}
          />
        </Stack>

        {/* ── Conflict warning ── */}
        {conflictingEvents.length > 0 ? (
          <Alert color="infini-warning" title={t("conflict.detected")}>
            {t("conflict.description", { count: conflictingEvents.length, titles: conflictingEvents
              .slice(0, 3)
              .map((item) => item.title)
              .join(", ") })}
          </Alert>
        ) : null}

        {/* ── Availability hint ── */}
        {availabilityMaxCount > 0 ? (
          <Text c="dimmed" size="xs">
            {t("availability.label")}{" "}
            {Array.from(availabilityDaysWithAny)
              .sort((left, right) => left - right)
              .map((day) => t(WEEKDAY_KEYS[day] ?? "weekday.sun"))
              .join(", ") || t("availability.none")}{" "}
            · {t("availability.peak")} {availabilityMaxCount}/{availabilityMemberCount} {t("availability.members")}
          </Text>
        ) : null}

        {/* ── Actions ── */}
        <Group justify="flex-end" mt={4}>
          <Button variant="default" onClick={onCancel} leftSection={<IconX size={16} />}>
            {t("button.cancel")}
          </Button>
          <Button onClick={onSave} loading={confirmLoading} leftSection={mode === "create" ? <IconPlus size={16} /> : <IconDeviceFloppy size={16} />}>
            {mode === "create" ? t("button.create") : t("button.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
