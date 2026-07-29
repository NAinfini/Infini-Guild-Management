import { EVENT_TYPES } from "@guild/shared";
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ActionIcon,
} from "@mantine/core";
import { XIcon, PlusIcon, SaveIcon } from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

type EventFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  canManage: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  eventType: (typeof EVENT_TYPES)[number] | "";
  onEventTypeChange: (value: (typeof EVENT_TYPES)[number] | "") => void;
  startAt: string;
  onStartAtChange: (value: string) => void;
  endAt: string;
  onEndAtChange: (value: string) => void;
  capacity: string;
  onCapacityChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  autoArchive: boolean;
  onAutoArchiveChange: (value: boolean) => void;
  pollOptions?: string[];
  onPollOptionsChange?: (value: string[]) => void;
  pollResultsVisibility?: "always" | "after_vote" | "after_close";
  onPollResultsVisibilityChange?: (value: "always" | "after_vote" | "after_close") => void;
  pollShowVoterNames?: boolean;
  onPollShowVoterNamesChange?: (value: boolean) => void;
  winnerCount?: string;
  onWinnerCountChange?: (value: string) => void;
  attachmentItems: ImageGridEditorItem[];
  onAttachmentsChange: (items: ImageGridEditorItem[]) => void;
  onFilesSelected: (files: File[]) => void;
  onAttachmentDelete: (item: ImageGridEditorItem) => void;
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
  autoArchive,
  onAutoArchiveChange,
  pollOptions = ["", ""],
  onPollOptionsChange,
  pollResultsVisibility = "after_vote",
  onPollResultsVisibilityChange,
  pollShowVoterNames = false,
  onPollShowVoterNamesChange,
  winnerCount = "",
  onWinnerCountChange,
  attachmentItems,
  onAttachmentsChange,
  onFilesSelected,
  onAttachmentDelete,
  availabilityDaysWithAny,
  availabilityMaxCount,
  availabilityMemberCount,
  confirmLoading,
  onCancel,
  onSave,
}: EventFormModalProps) {
  const { t } = useTranslation("events");
  const [titleTouched, setTitleTouched] = useState(false);

  const titleError = titleTouched && !title.trim() ? t("message.titleRequired") : undefined;
  const dateError = startAt && endAt && endAt < startAt ? t("field.endBeforeStart") : undefined;
  const isPoll = eventType === "poll";
  const isRaffle = eventType === "raffle";
  const pollOptionCount = pollOptions.map((option) => option.trim()).filter(Boolean).length;
  const pollError = isPoll && pollOptionCount < 2 ? t("poll.field.optionsInvalid") : undefined;
  const raffleWinnerCountNum = Number.parseInt(winnerCount, 10);
  const raffleError = isRaffle && (!Number.isFinite(raffleWinnerCountNum) || raffleWinnerCountNum < 1);
  const isSaveDisabled = !title.trim() || !eventType || Boolean(dateError)
    || (isPoll && (!endAt || Boolean(pollError)))
    || (isRaffle && (!endAt || raffleError));

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
          onChange={(event) => {
            setTitleTouched(true);
            onTitleChange(event.currentTarget.value);
          }}
          onBlur={() => setTitleTouched(true)}
          placeholder={t("field.title")}
          error={titleError}
          data-autofocus
        />

        {/* ── Type ── */}
        <Select
          label={t("filter.type")}
          value={eventType || null}
          onChange={(value) => value && onEventTypeChange(value as (typeof EVENT_TYPES)[number])}
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
          placeholder={t("field.selectType")}
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
            error={dateError}
          />
        </Group>

        {isPoll ? (
          <Stack gap={10}>
            <Text size="sm" fw={600}>{t("poll.field.options")}</Text>
            {pollOptions.map((option, index) => (
              <Group key={index} gap={8} wrap="nowrap">
                <TextInput
                  value={option}
                  onChange={(event) => {
                    const next = [...pollOptions];
                    next[index] = event.currentTarget.value;
                    onPollOptionsChange?.(next);
                  }}
                  placeholder={t("poll.field.optionPlaceholder", { index: index + 1 })}
                  error={index === pollOptions.length - 1 ? pollError : undefined}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={t("poll.field.removeOption")}
                  disabled={pollOptions.length <= 2}
                  onClick={() => onPollOptionsChange?.(pollOptions.filter((_, optionIndex) => optionIndex !== index))}
                >
                  <XIcon size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Button
              variant="light"
              size="xs"
              leftSection={<PlusIcon size={14} />}
              disabled={pollOptions.length >= 10}
              onClick={() => onPollOptionsChange?.([...pollOptions, ""])}
            >
              {t("poll.field.addOption")}
            </Button>
            <Select
              label={t("poll.field.resultsVisibility")}
              value={pollResultsVisibility}
              onChange={(value) => value && onPollResultsVisibilityChange?.(value as "always" | "after_vote" | "after_close")}
              data={[
                { value: "always", label: t("poll.visibility.always") },
                { value: "after_vote", label: t("poll.visibility.afterVote") },
                { value: "after_close", label: t("poll.visibility.afterClose") },
              ]}
            />
            <Switch
              checked={pollShowVoterNames}
              onChange={(event) => onPollShowVoterNamesChange?.(event.currentTarget.checked)}
              label={t("poll.field.showVoterNames")}
            />
          </Stack>
        ) : isRaffle ? (
          <Group grow wrap="wrap">
            <NumberInput
              label={t("raffle.field.winnerCount")}
              min={1}
              value={winnerCount === "" ? "" : raffleWinnerCountNum}
              onChange={(value) => onWinnerCountChange?.(String(value))}
              placeholder="1"
              styles={{ controls: { display: "none" } }}
            />
            <TextInput
              label={t("field.capacity")}
              type="number"
              min={1}
              max={9999}
              value={capacity}
              onChange={(event) => onCapacityChange(event.currentTarget.value)}
              placeholder={t("field.unlimited")}
            />
          </Group>
        ) : (
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
        )}

        {/* ── Description ── */}
        <Textarea
          label={t("field.description")}
          value={description}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
          minRows={3}
          placeholder={t("field.description")}
        />

        <Switch
          checked={autoArchive}
          onChange={(event) => onAutoArchiveChange(event.currentTarget.checked)}
          label={t("field.autoArchive")}
          description={t("field.autoArchiveHint")}
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
          <Button variant="default" onClick={onCancel} leftSection={<XIcon size={16} />}>
            {t("button.cancel")}
          </Button>
          <Button onClick={onSave} loading={confirmLoading} disabled={isSaveDisabled} leftSection={mode === "create" ? <PlusIcon size={16} /> : <SaveIcon size={16} />}>
            {mode === "create" ? t("button.create") : t("button.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
