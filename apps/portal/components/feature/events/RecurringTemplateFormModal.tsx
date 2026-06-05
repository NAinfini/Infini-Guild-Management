import { EVENT_TYPES, type RecurringTemplate } from "@guild/shared";
import {
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Radio,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { PlayerPauseIcon, PlayerPlayIcon, SaveIcon, PlusIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";
import { addDuration, buildFormState, localWeekdayToUtc, timeToTodayIso, WEEKDAY_KEYS, type DurationUnit, type RecurrenceEndMode, type RecurrenceFreq, type RecurringTemplateFormPayload, type RecurringTemplateFormState } from "./RecurringTemplateFormModal.helpers";

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
  onDelete?: (id: string) => void;
};

const sectionStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--radius-sm, 8px)",
  background: "var(--color-surface-elevated, #fff)",
  border: "1px solid var(--color-border, #E2DDD6)",
};

const weekdayBtnBase: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: 13,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 150ms ease",
};

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
  const { t } = useTranslation("events");
  const [formState, setFormState] = useState<RecurringTemplateFormState>(() => buildFormState(template));

  useEffect(() => {
    setFormState(buildFormState(template));
  }, [mode, open, template]);

  const {
    title,
    eventType,
    description,
    startTime,
    durationValue,
    durationUnit,
    capacity,
    recurrenceFreq,
    recurrenceInterval,
    recurrenceDays,
    recurrenceMonthDay,
    recurrenceEndMode,
    recurrenceEndDate,
    recurrenceEndCount,
    visibilityOffsetHours,
    visibilityOffsetMinutes,
    autoArchive,
  } = formState;

  const handleSave = useCallback(() => {
    const startIso = timeToTodayIso(startTime);
    if (!startIso || !title.trim() || !eventType) {
      notifyError(t("recurring.message.validationFailed"));
      return;
    }

    const endIso = durationValue > 0 ? addDuration(startIso, durationValue, durationUnit) : undefined;

    const offsetH = typeof visibilityOffsetHours === "number" ? visibilityOffsetHours : 0;
    const offsetM = typeof visibilityOffsetMinutes === "number" ? visibilityOffsetMinutes : 0;
    const totalOffsetMinutes = offsetH * 60 + offsetM;

    onSave({
      type: eventType,
      title: title.trim(),
      description: description.trim() || undefined,
      start_at: startIso,
      end_at: endIso,
      capacity: capacity.trim() ? Math.max(1, Number.parseInt(capacity, 10)) : undefined,
      recurrence_rule: {
        frequency: recurrenceFreq,
        interval: Math.max(1, Number.parseInt(recurrenceInterval || "1", 10)),
        daysOfWeek: recurrenceFreq === "weekly"
          ? Array.from(new Set(recurrenceDays.map((d) => localWeekdayToUtc(d, startIso)))).sort((a, b) => a - b)
          : undefined,
        dayOfMonth: recurrenceFreq === "monthly" ? Math.max(1, Math.min(31, Number.parseInt(recurrenceMonthDay || "1", 10))) : undefined,
        endAfter: recurrenceEndMode === "count" ? Math.max(1, Number.parseInt(recurrenceEndCount || "1", 10)) : undefined,
        endDate: recurrenceEndMode === "date" && recurrenceEndDate.trim() ? new Date(recurrenceEndDate).toISOString() : undefined,
      },
      visibility_offset_minutes: totalOffsetMinutes > 0 ? totalOffsetMinutes : undefined,
      auto_archive: autoArchive,
    });
  }, [
    startTime, durationValue, durationUnit, title, description, eventType, capacity,
    recurrenceFreq, recurrenceInterval, recurrenceDays, recurrenceMonthDay,
    recurrenceEndMode, recurrenceEndDate, recurrenceEndCount,
    visibilityOffsetHours, visibilityOffsetMinutes, autoArchive, onSave, t,
  ]);

  const isPaused = mode === "edit" && template?.archived_at !== null;

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
      size="lg"
    >
      <Stack gap={20}>
        {/* ═══════ Event Details ═══════ */}
        <div>
          <Divider label={t("recurring.section.details")} labelPosition="left" mb={12} />
          <Stack gap={12} style={sectionStyle}>
            <Group grow wrap="wrap" align="flex-start">
              <TextInput
                label={t("field.title")}
                value={title}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, title: event.currentTarget.value }))
                }
                placeholder={t("field.title")}
                style={{ flex: 2, minWidth: 180 }}
              />
              <Select
                label={t("filter.type")}
                value={eventType || null}
                onChange={(value) =>
                  setFormState((current) => ({
                    ...current,
                    eventType: (value ?? "") as (typeof EVENT_TYPES)[number],
                  }))
                }
                data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
                placeholder={t("recurring.field.typePlaceholder")}
                clearable
                style={{ flex: 1, minWidth: 140 }}
              />
            </Group>
            <Textarea
              label={t("field.description")}
              value={description}
              onChange={(event) =>
                setFormState((current) => ({ ...current, description: event.currentTarget.value }))
              }
              minRows={2}
              autosize
              maxRows={5}
              placeholder={t("field.description")}
            />
          </Stack>
        </div>

        {/* ═══════ Schedule ═══════ */}
        <div>
          <Divider label={t("recurring.section.schedule")} labelPosition="left" mb={12} />
          <Stack gap={12} style={sectionStyle}>
            <Group grow wrap="wrap" align="flex-end">
              <TextInput
                label={t("recurring.field.startTime")}
                type="time"
                value={startTime}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, startTime: event.currentTarget.value }))
                }
                style={{ flex: 1, minWidth: 120 }}
              />
              <Group gap={8} align="flex-end" wrap="nowrap" style={{ flex: 1, minWidth: 180 }}>
                <NumberInput
                  label={t("recurring.field.duration")}
                  value={durationValue}
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      durationValue: typeof value === "number" ? value : 0,
                    }))
                  }
                  min={0}
                  hideControls
                  style={{ flex: 1 }}
                />
                <Select
                  value={durationUnit}
                  onChange={(value) =>
                    value &&
                    setFormState((current) => ({
                      ...current,
                      durationUnit: value as DurationUnit,
                    }))
                  }
                  data={[
                    { value: "minutes", label: t("recurring.field.durationUnit.minutes") },
                    { value: "hours", label: t("recurring.field.durationUnit.hours") },
                  ]}
                  style={{ width: 100 }}
                />
              </Group>
            </Group>
            <TextInput
              label={t("field.capacity")}
              type="number"
              value={capacity}
              onChange={(event) =>
                setFormState((current) => ({ ...current, capacity: event.currentTarget.value }))
              }
              placeholder={t("field.unlimited")}
              style={{ maxWidth: 160 }}
            />
          </Stack>
        </div>

        {/* ═══════ Recurrence Pattern ═══════ */}
        <div>
          <Divider label={t("recurring.section.recurrence")} labelPosition="left" mb={12} />
          <Stack gap={14} style={sectionStyle}>
            <Group align="flex-end" gap={8}>
              <Text size="sm" fw={500} pb={6}>{t("field.interval")}</Text>
              <TextInput
                type="number"
                value={recurrenceInterval}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    recurrenceInterval: event.currentTarget.value,
                  }))
                }
                style={{ width: 72 }}
                min={1}
              />
              <Select
                value={recurrenceFreq}
                onChange={(value) =>
                  value &&
                  setFormState((current) => ({
                    ...current,
                    recurrenceFreq: value as RecurrenceFreq,
                  }))
                }
                data={[
                  { value: "daily", label: t("recurrence.freqDay") },
                  { value: "weekly", label: t("recurrence.freqWeek") },
                  { value: "monthly", label: t("recurrence.freqMonth") },
                ]}
                style={{ width: 120 }}
              />
            </Group>

            {recurrenceFreq === "weekly" ? (
              <Stack gap={4}>
                <Text size="sm" fw={500}>{t("field.weekdays")}</Text>
                <Group gap={4}>
                  {WEEKDAY_KEYS.map((key, index) => {
                    const isSelected = recurrenceDays.includes(index);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setFormState((current) => ({
                              ...current,
                              recurrenceDays: current.recurrenceDays.filter((d) => d !== index),
                            }));
                          } else {
                            setFormState((current) => ({
                              ...current,
                              recurrenceDays: [...current.recurrenceDays, index],
                            }));
                          }
                        }}
                        style={{
                          ...weekdayBtnBase,
                          border: isSelected ? "2px solid var(--color-primary, #D4A843)" : "1px solid var(--color-border, #E2DDD6)",
                          background: isSelected ? "var(--color-primary, #D4A843)" : "transparent",
                          color: isSelected ? "#fff" : "var(--color-text, #1A1815)",
                          fontWeight: isSelected ? 600 : 400,
                        }}
                      >
                        {t(key)}
                      </button>
                    );
                  })}
                </Group>
              </Stack>
            ) : null}

            {recurrenceFreq === "monthly" ? (
              <Select
                label={t("field.monthDay")}
                value={recurrenceMonthDay}
                onChange={(value) =>
                  value &&
                  setFormState((current) => ({
                    ...current,
                    recurrenceMonthDay: value,
                  }))
                }
                data={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                style={{ width: 100 }}
              />
            ) : null}

            <Divider variant="dashed" />

            <Stack gap={8}>
              <Text size="sm" fw={500}>{t("recurrence.endLabel")}</Text>
              <Radio.Group
                value={recurrenceEndMode}
                onChange={(value) =>
                  setFormState((current) => ({
                    ...current,
                    recurrenceEndMode: value as RecurrenceEndMode,
                  }))
                }
              >
                <Stack gap={10}>
                  <Radio value="never" label={t("recurrence.endNever")} />
                  <Group gap={8} align="center">
                    <Radio value="date" label={`${t("recurrence.endDate")}:`} />
                    <TextInput
                      type="date"
                      value={recurrenceEndDate}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          recurrenceEndDate: event.currentTarget.value,
                        }))
                      }
                      disabled={recurrenceEndMode !== "date"}
                      style={{ width: 170 }}
                    />
                  </Group>
                  <Group gap={8} align="center">
                    <Radio value="count" label={t("recurrence.endAfterLabel")} />
                    <TextInput
                      type="number"
                      value={recurrenceEndCount}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          recurrenceEndCount: event.currentTarget.value,
                        }))
                      }
                      disabled={recurrenceEndMode !== "count"}
                      style={{ width: 72 }}
                      min={1}
                    />
                    <Text size="sm" c="dimmed">{t("recurrence.endAfterSuffix")}</Text>
                  </Group>
                </Stack>
              </Radio.Group>
            </Stack>
          </Stack>
        </div>

        {/* ═══════ Options ═══════ */}
        <div>
          <Divider label={t("recurring.section.options")} labelPosition="left" mb={12} />
          <Stack gap={12} style={sectionStyle}>
            <div>
              <Text size="sm" fw={500} mb={4}>{t("recurring.field.visibilityOffset")}</Text>
              <Group gap={8} wrap="nowrap" style={{ maxWidth: 300 }}>
                <NumberInput
                  value={visibilityOffsetHours}
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      visibilityOffsetHours: typeof value === "number" ? value : "",
                    }))
                  }
                  min={0}
                  hideControls
                  suffix={` ${t("recurring.field.durationUnit.hours").toLowerCase()}`}
                  style={{ flex: 1 }}
                />
                <NumberInput
                  value={visibilityOffsetMinutes}
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      visibilityOffsetMinutes: typeof value === "number" ? value : "",
                    }))
                  }
                  min={0}
                  max={59}
                  hideControls
                  suffix={` ${t("recurring.field.durationUnit.minutes").toLowerCase()}`}
                  style={{ flex: 1 }}
                />
              </Group>
              <Text size="xs" c="dimmed" mt={4}>{t("recurring.field.visibilityOffsetHint")}</Text>
            </div>
            <Switch
              checked={autoArchive}
              onChange={(event) =>
                setFormState((current) => ({ ...current, autoArchive: event.currentTarget.checked }))
              }
              label={t("field.autoArchive")}
              description={t("field.autoArchiveHint")}
            />
          </Stack>
        </div>

        {/* ═══════ Actions ═══════ */}
        <Divider />
        <Group justify={mode === "edit" ? "space-between" : "flex-end"} wrap="wrap" gap={8}>
          {mode === "edit" && template && (
            <Group gap={8}>
              {template.archived_at ? (
                <Button
                  variant="light"
                  color="green"
                  leftSection={<PlayerPlayIcon size={16} />}
                  onClick={() => { void onResume?.(template.id); onCancel(); }}
                >
                  {t("recurring.resume")}
                </Button>
              ) : (
                <Button
                  variant="light"
                  color="yellow"
                  leftSection={<PlayerPauseIcon size={16} />}
                  onClick={() => { void onPause?.(template.id); onCancel(); }}
                >
                  {t("recurring.pause")}
                </Button>
              )}
              <Button
                variant="light"
                color="red"
                leftSection={<TrashIcon size={16} />}
                onClick={() => { onDelete?.(template.id); }}
              >
                {t("recurring.delete")}
              </Button>
            </Group>
          )}
          <Group gap={8}>
            <DepthButton type="secondary" onClick={onCancel} before={<XIcon size={16} />}>
              {t("button.cancel")}
            </DepthButton>
            <DepthButton type="primary" onClick={handleSave} loading={confirmLoading} before={mode === "create" ? <PlusIcon size={16} /> : <SaveIcon size={16} />}>
              {mode === "create" ? t("recurring.create") : t("button.save")}
            </DepthButton>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
