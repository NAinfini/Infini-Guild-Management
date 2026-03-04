import type { Event } from "@guild/shared";
import { EVENT_TYPES } from "@guild/shared";
import {
  Alert,
  Button,
  Group,
  Modal,
  MultiSelect,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";

type RecurrenceFreq = "daily" | "weekly" | "monthly";
type RecurrenceApplyScope = "this" | "future" | "all";

type AttachmentUploaderState = {
  files: File[];
  isUploading: boolean;
  error: string | null;
  selectFiles: (source: FileList | File[] | null) => void;
};

type EventFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  canManage: boolean;
  editingEventId: string | null;
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
  pinned: boolean;
  onPinnedChange: (checked: boolean) => void;
  signupLocked: boolean;
  onSignupLockedChange: (checked: boolean) => void;
  recurrenceEnabled: boolean;
  onRecurrenceEnabledChange: (checked: boolean) => void;
  recurrenceFreq: RecurrenceFreq;
  onRecurrenceFreqChange: (value: RecurrenceFreq) => void;
  recurrenceInterval: string;
  onRecurrenceIntervalChange: (value: string) => void;
  recurrenceDays: number[];
  onRecurrenceDaysChange: (value: number[]) => void;
  recurrenceApplyTo: RecurrenceApplyScope;
  onRecurrenceApplyToChange: (value: RecurrenceApplyScope) => void;
  attachments: string[];
  onRemoveAttachment: (index: number) => void;
  attachmentUploader: AttachmentUploaderState;
  onUploadAttachments: () => void;
  conflictingEvents: Event[];
  showAvailabilityOverlay: boolean;
  availabilityDaysWithAny: Set<number>;
  availabilityMaxCount: number;
  availabilityMemberCount: number;
  confirmLoading: boolean;
  onCancel: () => void;
  onSave: () => void;
};

const WEEKDAY_SHORT_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function EventFormModal({
  open,
  mode,
  canManage,
  editingEventId,
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
  pinned,
  onPinnedChange,
  signupLocked,
  onSignupLockedChange,
  recurrenceEnabled,
  onRecurrenceEnabledChange,
  recurrenceFreq,
  onRecurrenceFreqChange,
  recurrenceInterval,
  onRecurrenceIntervalChange,
  recurrenceDays,
  onRecurrenceDaysChange,
  recurrenceApplyTo,
  onRecurrenceApplyToChange,
  attachments,
  onRemoveAttachment,
  attachmentUploader,
  onUploadAttachments,
  conflictingEvents,
  showAvailabilityOverlay,
  availabilityDaysWithAny,
  availabilityMaxCount,
  availabilityMemberCount,
  confirmLoading,
  onCancel,
  onSave,
}: EventFormModalProps) {
  return (
    <Modal
      title={mode === "create" ? "Create Event" : "Edit Event"}
      opened={open}
      onClose={onCancel}
      closeOnClickOutside={false}
      closeOnEscape
      centered
      size="lg"
    >
      <Stack gap={10}>
        <TextInput
          value={title}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          placeholder="Event title"
          aria-label="Event title"
        />

        <Select
          value={eventType}
          aria-label="Event type"
          onChange={(value) => value && onEventTypeChange(value as (typeof EVENT_TYPES)[number])}
          data={EVENT_TYPES.map((value) => ({ value, label: value }))}
        />

        <Group align="flex-end" wrap="wrap">
          <div>
            <Text size="sm">Start</Text>
            <TextInput
              type="datetime-local"
              value={startAt}
              onChange={(event) => onStartAtChange(event.currentTarget.value)}
              aria-label="Event start time"
            />
          </div>
          <div>
            <Text size="sm">End</Text>
            <TextInput
              type="datetime-local"
              value={endAt}
              onChange={(event) => onEndAtChange(event.currentTarget.value)}
              aria-label="Event end time"
            />
          </div>
          <div>
            <Text size="sm">Capacity</Text>
            <TextInput
              type="number"
              value={capacity}
              onChange={(event) => onCapacityChange(event.currentTarget.value)}
              placeholder="Unlimited"
              aria-label="Event capacity"
            />
          </div>
        </Group>

        <Textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
          minRows={3}
          placeholder="Description"
          aria-label="Event description"
        />

        <Group wrap="wrap" gap={10}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Switch checked={pinned} onChange={(event) => onPinnedChange(event.currentTarget.checked)} />
            <span>Pinned</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Switch checked={signupLocked} onChange={(event) => onSignupLockedChange(event.currentTarget.checked)} />
            <span>Signup locked</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Switch checked={recurrenceEnabled} onChange={(event) => onRecurrenceEnabledChange(event.currentTarget.checked)} />
            <span>Recurring</span>
          </label>
        </Group>

        {recurrenceEnabled ? (
          <Group align="flex-end" wrap="wrap">
            <Select
              style={{ width: 160 }}
              value={recurrenceFreq}
              aria-label="Event recurrence frequency"
              onChange={(value) => value && onRecurrenceFreqChange(value as RecurrenceFreq)}
              data={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
            <TextInput
              style={{ width: 120 }}
              type="number"
              value={recurrenceInterval}
              onChange={(event) => onRecurrenceIntervalChange(event.currentTarget.value)}
              placeholder="Interval"
              aria-label="Event recurrence interval"
            />
            {recurrenceFreq === "weekly" ? (
              <MultiSelect
                style={{ width: 320 }}
                value={recurrenceDays.map((item) => String(item))}
                aria-label="Event recurrence weekdays"
                onChange={(value) => onRecurrenceDaysChange(value.map((item) => Number(item)).filter(Number.isFinite))}
                data={[
                  { value: "0", label: "Sun" },
                  { value: "1", label: "Mon" },
                  { value: "2", label: "Tue" },
                  { value: "3", label: "Wed" },
                  { value: "4", label: "Thu" },
                  { value: "5", label: "Fri" },
                  { value: "6", label: "Sat" },
                ]}
              />
            ) : null}
          </Group>
        ) : null}

        {mode === "edit" && recurrenceEnabled ? (
          <Stack style={{ width: "100%" }} gap={4}>
            <Text size="sm">Apply recurrence edits to</Text>
            <SegmentedControl
              value={recurrenceApplyTo}
              onChange={(value) => onRecurrenceApplyToChange(value as RecurrenceApplyScope)}
              data={[
                { label: "This event", value: "this" },
                { label: "This + future", value: "future" },
                { label: "All in series", value: "all" },
              ]}
            />
            <Text c="dimmed" size="xs">
              Recurrence scope is supported. Time changes apply to this instance; shared fields can propagate by scope.
            </Text>
          </Stack>
        ) : null}

        <Stack style={{ width: "100%" }} gap={6}>
          <Text size="sm">Attachments ({attachments.length}/5)</Text>
          {attachments.length === 0 ? (
            <Text c="dimmed" size="sm">No attachments</Text>
          ) : (
            attachments.map((attachment, index) => (
              <Group key={`${attachment}-${index}`} align="flex-start" wrap="nowrap">
                {isHttpUrl(attachment) ? (
                  <img
                    src={attachment}
                    alt="Event attachment"
                    loading="lazy"
                    decoding="async"
                    style={{ width: 80, height: 56, borderRadius: 8, objectFit: "cover" }}
                  />
                ) : (
                  <Text c="dimmed" size="sm" style={{ wordBreak: "break-all", maxWidth: 360 }}>
                    {attachment}
                  </Text>
                )}
                {canManage ? (
                  <Button size="xs" color="red" onClick={() => onRemoveAttachment(index)}>
                    Remove
                  </Button>
                ) : null}
              </Group>
            ))
          )}

          {canManage && mode === "edit" && editingEventId ? (
            <Stack style={{ width: "100%" }} gap={4}>
              <input
                type="file"
                multiple
                accept="image/*"
                aria-label="Upload event attachments"
                onChange={(event) => attachmentUploader.selectFiles(event.target.files)}
              />
              {attachmentUploader.error ? <Text c="red" size="sm">{attachmentUploader.error}</Text> : null}
              <Button
                onClick={onUploadAttachments}
                loading={attachmentUploader.isUploading}
                disabled={attachmentUploader.files.length === 0 || attachments.length >= 5}
              >
                Upload attachments
              </Button>
            </Stack>
          ) : null}
        </Stack>

        {conflictingEvents.length > 0 ? (
          <Alert color="yellow" title="Time conflict detected">
            {`Conflicts with ${conflictingEvents.length} event(s): ${conflictingEvents
              .slice(0, 3)
              .map((item) => item.title)
              .join(", ")}`}
          </Alert>
        ) : null}

        {showAvailabilityOverlay ? (
          <Text c="dimmed" size="xs">
            Team availability:{" "}
            {Array.from(availabilityDaysWithAny)
              .sort((left, right) => left - right)
              .map((day) => WEEKDAY_SHORT_LABELS[day] ?? String(day))
              .join(", ") || "none"}{" "}
            · Peak {availabilityMaxCount}/{availabilityMemberCount} members
          </Text>
        ) : null}

        <Group justify="flex-end" mt={4}>
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={confirmLoading}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

