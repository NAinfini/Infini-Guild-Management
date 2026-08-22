import type { RecurringTemplate } from "@guild/shared";
import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { PlayerPauseIcon, PlayerPlayIcon, SaveIcon, PlusIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { eventHasBehavior } from "@portal/utils/game-rules";
import { notifyError } from "../../../utils/notifications";
import {
  RecurringTemplateProducesFields,
  RecurringTemplateTimingFields,
} from "./RecurringTemplateFormFields";
import { RecurringTemplateLifecycle } from "./RecurringTemplatePreview";
import {
  buildFormState,
  buildRecurrenceRule,
  computeNextLifecyclePreview,
  localClockAnchorIso,
  localClockToUtcAt,
  templateScheduleAnchor,
  type RecurringTemplateFormPayload,
  type RecurringTemplateFormState,
} from "./RecurringTemplateFormModal.helpers";
import "./RecurringTemplateFormModal.css";

export type { RecurringTemplateFormPayload } from "./RecurringTemplateFormModal.helpers";

type RecurringTemplateFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  template: RecurringTemplate | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSave: (payload: RecurringTemplateFormPayload) => void;
  onPause?: (id: string) => Promise<unknown>;
  onResume?: (id: string) => Promise<unknown>;
  onDelete?: (id: string) => Promise<void>;
};

// The two columns separate generated event content from recurrence timing.
export function RecurringTemplateFormModal({
  open,
  mode,
  template,
  confirmLoading,
  onCancel,
  onSave,
  onPause,
  onResume,
  onDelete,
}: RecurringTemplateFormModalProps) {
  const { t, i18n } = useTranslation("events");
  const [formState, setFormState] = useState<RecurringTemplateFormState>(() => buildFormState(template));

  useEffect(() => {
    setFormState(buildFormState(template));
  }, [mode, open, template]);

  const handleSave = useCallback(() => {
    const {
      title, eventType, description, startTime, durationValue, durationUnit, capacity, classQuotas,
      recurrenceFreq, recurrenceDays,
      visibilityOffsetDays, visibilityOffsetHours, visibilityOffsetMinutes, autoArchive,
    } = formState;

    if (!startTime || !title.trim() || !eventType || (recurrenceFreq === "weekly" && recurrenceDays.length === 0)) {
      notifyError(t("recurring.message.validationFailed"));
      return;
    }

    const durationMinutes = durationValue > 0
      ? durationValue * (durationUnit === "hours" ? 60 : 1)
      : mode === "edit" ? null : undefined;

    const recurrenceReference = template ? templateScheduleAnchor(template) ?? new Date() : new Date();
    const anchorIso = localClockAnchorIso(startTime, recurrenceReference);

    const offsetD = typeof visibilityOffsetDays === "number" ? visibilityOffsetDays : 0;
    const offsetH = typeof visibilityOffsetHours === "number" ? visibilityOffsetHours : 0;
    const offsetM = typeof visibilityOffsetMinutes === "number" ? visibilityOffsetMinutes : 0;
    const totalOffsetMinutes = offsetD * 1440 + offsetH * 60 + offsetM;

    onSave({
      type: eventType,
      title: title.trim(),
      description: description.trim() || (mode === "edit" ? null : ""),
      start_time: localClockToUtcAt(startTime, recurrenceReference),
      duration_minutes: durationMinutes,
      capacity: capacity.trim() ? Math.max(1, Number.parseInt(capacity, 10)) : mode === "edit" ? null : undefined,
      recurrence_rule: buildRecurrenceRule(formState, anchorIso),
      visibility_offset_minutes: totalOffsetMinutes,
      auto_archive: autoArchive,
      /* 切成投票/抽奖时控件只是藏了，状态还在；这两种类型带着配额会被服务端整个拒收。 */
      class_quotas: eventHasBehavior(eventType, "poll") || eventHasBehavior(eventType, "raffle") ? [] : classQuotas,
    });
  }, [formState, onSave, t]);

  const lifecycle = useMemo(
    () => computeNextLifecyclePreview(formState, template, mode),
    [formState, template, mode],
  );

  const isPaused = mode === "edit" && (template?.paused ?? false);
  const locale = i18n?.language ?? "en";
  const isSaveDisabled = !formState.title.trim() || !formState.startTime || !formState.eventType;
  const handlePauseResume = useCallback(async () => {
    if (!template) return;
    const action = template.paused ? onResume : onPause;
    if (!action) return;
    try {
      await action(template.id);
    } catch {
      // The mutation owner reports failures; retain the modal for correction.
      return;
    }
    onCancel();
  }, [onCancel, onPause, onResume, template]);
  const handleDelete = useCallback(async () => {
    if (!template || !onDelete) return;
    try {
      await onDelete(template.id);
    } catch {
      // The mutation owner reports failures; retain the modal for correction.
    }
  }, [onDelete, template]);

  return (
    <Modal
      title={
        <Group gap={8} align="center">
          <Text fw={600}>{mode === "create" ? t("recurring.create") : t("recurring.edit")}</Text>
          {mode === "edit" && template && (
            <Badge size="sm" variant="light" color={isPaused ? "gray" : "green"}>
              {isPaused ? t("recurring.status.paused") : t("recurring.status.active")}
            </Badge>
          )}
        </Group>
      }
      opened={open}
      onClose={onCancel}
      closeOnClickOutside={false}
      closeOnEscape
      centered
      size="xl"
    >
      <Stack gap={20}>
        <div className="rtf-columns">
          <div className="rtf-col">
            <RecurringTemplateProducesFields formState={formState} setFormState={setFormState} />
          </div>
          <div className="rtf-col">
            <RecurringTemplateTimingFields formState={formState} setFormState={setFormState} />
            <RecurringTemplateLifecycle lifecycle={lifecycle} locale={locale} />
          </div>
        </div>

        <div className="rtf-actions-divider" />
        <Group justify={mode === "edit" ? "space-between" : "flex-end"} wrap="wrap" gap={8}>
          {mode === "edit" && template && (
            <Group gap={8}>
              {template.paused ? (
                <Button
                  variant="light"
                  color="green"
                  leftSection={<PlayerPlayIcon size={16} />}
                  onClick={() => { void handlePauseResume(); }}
                >
                  {t("recurring.resume")}
                </Button>
              ) : (
                <Button
                  variant="light"
                  color="orange"
                  leftSection={<PlayerPauseIcon size={16} />}
                  onClick={() => { void handlePauseResume(); }}
                >
                  {t("recurring.pause")}
                </Button>
              )}
              <Button
                variant="light"
                color="red"
                leftSection={<TrashIcon size={16} />}
                onClick={() => { void handleDelete(); }}
              >
                {t("recurring.delete")}
              </Button>
            </Group>
          )}
          <Group gap={8}>
            <Button variant="default" onClick={onCancel} leftSection={<XIcon size={16} />}>
              {t("button.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              loading={confirmLoading}
              disabled={isSaveDisabled}
              leftSection={mode === "create" ? <PlusIcon size={16} /> : <SaveIcon size={16} />}
            >
              {mode === "create" ? t("recurring.create") : t("button.save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
