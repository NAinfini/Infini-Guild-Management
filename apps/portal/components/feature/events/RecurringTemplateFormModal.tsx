import { EVENT_TYPES, type RecurringTemplate } from "@guild/shared";
import {
  Button,
  Group,
  Modal,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy, IconPlus, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type RecurrenceFreq = "daily" | "weekly" | "monthly";
type RecurrenceEndMode = "never" | "date" | "count";

export type RecurringTemplateFormPayload = {
  type: (typeof EVENT_TYPES)[number];
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  capacity?: number;
  recurrence_rule: {
    frequency: RecurrenceFreq;
    interval: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endAfter?: number;
    endDate?: string;
  };
};

type RecurringTemplateFormState = {
  title: string;
  eventType: (typeof EVENT_TYPES)[number];
  description: string;
  startAt: string;
  endAt: string;
  capacity: string;
  recurrenceFreq: RecurrenceFreq;
  recurrenceInterval: string;
  recurrenceDays: number[];
  recurrenceMonthDay: string;
  recurrenceEndMode: RecurrenceEndMode;
  recurrenceEndDate: string;
  recurrenceEndCount: string;
};

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const shifted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toIso(input: string): string | undefined {
  if (!input.trim()) return undefined;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

type RecurringTemplateFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  template: RecurringTemplate | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSave: (payload: RecurringTemplateFormPayload) => void;
};

function buildFormState(template: RecurringTemplate | null): RecurringTemplateFormState {
  return {
    title: template?.title ?? "",
    eventType: (template?.type as (typeof EVENT_TYPES)[number]) ?? "guild_war",
    description: template?.description ?? "",
    startAt: template ? toLocalInput(template.start_at) : "",
    endAt: template ? toLocalInput(template.end_at) : "",
    capacity: template?.capacity === null ? "" : String(template?.capacity ?? ""),
    recurrenceFreq: template?.recurrence_rule?.frequency ?? "weekly",
    recurrenceInterval: String(template?.recurrence_rule?.interval ?? 1),
    recurrenceDays: template?.recurrence_rule?.daysOfWeek ?? [1, 3, 5],
    recurrenceMonthDay: template?.recurrence_rule?.dayOfMonth ? String(template.recurrence_rule.dayOfMonth) : "1",
    recurrenceEndMode: template?.recurrence_rule?.endDate
      ? "date"
      : template?.recurrence_rule?.endAfter
        ? "count"
        : "never",
    recurrenceEndDate: template?.recurrence_rule?.endDate
      ? toLocalInput(template.recurrence_rule.endDate).slice(0, 10)
      : "",
    recurrenceEndCount: template?.recurrence_rule?.endAfter
      ? String(template.recurrence_rule.endAfter)
      : "13",
  };
}

export function RecurringTemplateFormModal({
  open,
  mode,
  template,
  confirmLoading,
  onCancel,
  onSave,
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
    startAt,
    endAt,
    capacity,
    recurrenceFreq,
    recurrenceInterval,
    recurrenceDays,
    recurrenceMonthDay,
    recurrenceEndMode,
    recurrenceEndDate,
    recurrenceEndCount,
  } = formState;

  const handleSave = useCallback(() => {
    const startIso = toIso(startAt);
    if (!startIso || !title.trim()) {
      notifications.show({ color: "infini-danger", message: t("recurring.message.validationFailed") });
      return;
    }

    const endIso = toIso(endAt);

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
        daysOfWeek: recurrenceFreq === "weekly" ? recurrenceDays : undefined,
        dayOfMonth: recurrenceFreq === "monthly" ? Math.max(1, Math.min(31, Number.parseInt(recurrenceMonthDay || "1", 10))) : undefined,
        endAfter: recurrenceEndMode === "count" ? Math.max(1, Number.parseInt(recurrenceEndCount || "1", 10)) : undefined,
        endDate: recurrenceEndMode === "date" && recurrenceEndDate.trim() ? new Date(recurrenceEndDate).toISOString() : undefined,
      },
    });
  }, [
    startAt, endAt, title, description, eventType, capacity,
    recurrenceFreq, recurrenceInterval, recurrenceDays, recurrenceMonthDay,
    recurrenceEndMode, recurrenceEndDate, recurrenceEndCount, onSave, t,
  ]);

  return (
    <Modal
      title={mode === "create" ? t("recurring.create") : t("recurring.edit")}
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
          onChange={(event) =>
            setFormState((current) => ({ ...current, title: event.currentTarget.value }))
          }
          placeholder={t("field.title")}
        />

        {/* ── Type ── */}
        <Select
          label={t("filter.type")}
          value={eventType}
          onChange={(value) =>
            value &&
            setFormState((current) => ({
              ...current,
              eventType: value as (typeof EVENT_TYPES)[number],
            }))
          }
          data={EVENT_TYPES.map((value) => ({ value, label: t(`common:eventType.${value}`) }))}
        />

        {/* ── Event time (time-of-day reference) ── */}
        <Group grow wrap="wrap">
          <TextInput
            label={t("recurring.field.startTime")}
            type="datetime-local"
            value={startAt}
            onChange={(event) =>
              setFormState((current) => ({ ...current, startAt: event.currentTarget.value }))
            }
          />
          <TextInput
            label={t("recurring.field.duration")}
            type="datetime-local"
            value={endAt}
            onChange={(event) =>
              setFormState((current) => ({ ...current, endAt: event.currentTarget.value }))
            }
          />
        </Group>

        {/* ── Capacity ── */}
        <TextInput
          label={t("field.capacity")}
          type="number"
          value={capacity}
          onChange={(event) =>
            setFormState((current) => ({ ...current, capacity: event.currentTarget.value }))
          }
          placeholder={t("field.unlimited")}
          style={{ maxWidth: 200 }}
        />

        {/* ── Description ── */}
        <Textarea
          label={t("field.description")}
          value={description}
          onChange={(event) =>
            setFormState((current) => ({ ...current, description: event.currentTarget.value }))
          }
          minRows={3}
          placeholder={t("field.description")}
        />

        {/* ── Recurrence settings ── */}
        <Stack gap={14} style={{ padding: "14px", borderRadius: "8px", background: "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--infini-color-primary, #3b82f6) 15%, transparent)" }}>
          {/* ── Frequency: "Every [N] [day/week/month]" ── */}
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

          {/* ── Weekday pills (weekly only) ── */}
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
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        border: isSelected ? "2px solid var(--infini-color-primary, #3b82f6)" : "1px solid color-mix(in srgb, var(--infini-color-text, #111827) 20%, transparent)",
                        background: isSelected ? "var(--infini-color-primary, #3b82f6)" : "transparent",
                        color: isSelected ? "#fff" : "var(--infini-color-text, #111827)",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: isSelected ? 600 : 400,
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 150ms ease",
                      }}
                    >
                      {t(key)}
                    </button>
                  );
                })}
              </Group>
            </Stack>
          ) : null}

          {/* ── Day of month (monthly only) ── */}
          {recurrenceFreq === "monthly" ? (
            <Group align="flex-end" gap={8}>
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
            </Group>
          ) : null}

          {/* ── End condition ── */}
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

        {/* ── Actions ── */}
        <Group justify="flex-end" mt={4}>
          <Button variant="default" onClick={onCancel} leftSection={<IconX size={16} />}>
            {t("button.cancel")}
          </Button>
          <Button onClick={handleSave} loading={confirmLoading} leftSection={mode === "create" ? <IconPlus size={16} /> : <IconDeviceFloppy size={16} />}>
            {mode === "create" ? t("recurring.create") : t("button.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
