import { EVENT_TYPES, type RecurringTemplate } from "@guild/shared";
import {
  Badge,
  Button,
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
import { CalendarRepeatIcon, PlayerPauseIcon, PlayerPlayIcon, SaveIcon, PlusIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { ClassQuotaEditor } from "./ClassQuotaEditor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";
import {
  buildFormState,
  computeNextLifecyclePreview,
  formatLifecycleDate,
  localTimeToUtcTime,
  localWeekdayToUtc,
  tzOffsetToAnchorIso,
  WEEKDAY_KEYS,
  type DurationUnit,
  type RecurrenceEndMode,
  type RecurrenceFreq,
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
  onDelete?: (id: string) => void;
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
  const { t, i18n } = useTranslation("events");
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
    classQuotas,
    recurrenceFreq,
    recurrenceInterval,
    recurrenceDays,
    recurrenceMonthDay,
    recurrenceEndMode,
    recurrenceEndDate,
    recurrenceEndCount,
    visibilityOffsetDays,
    visibilityOffsetHours,
    visibilityOffsetMinutes,
    autoArchive,
  } = formState;

  const handleSave = useCallback(() => {
    if (!startTime || !title.trim() || !eventType) {
      notifyError(t("recurring.message.validationFailed"));
      return;
    }

    const durationMinutes = durationValue > 0
      ? durationValue * (durationUnit === "hours" ? 60 : 1)
      : undefined;

    // Anchor on the event's actual instant (local time + current offset) so the
    // local→UTC weekday conversion below is exact across midnight boundaries.
    const anchorIso = tzOffsetToAnchorIso(-new Date().getTimezoneOffset(), startTime);

    const offsetD = typeof visibilityOffsetDays === "number" ? visibilityOffsetDays : 0;
    const offsetH = typeof visibilityOffsetHours === "number" ? visibilityOffsetHours : 0;
    const offsetM = typeof visibilityOffsetMinutes === "number" ? visibilityOffsetMinutes : 0;
    const totalOffsetMinutes = offsetD * 1440 + offsetH * 60 + offsetM;

    onSave({
      type: eventType,
      title: title.trim(),
      description: description.trim() || undefined,
      start_time: localTimeToUtcTime(startTime),
      duration_minutes: durationMinutes,
      capacity: capacity.trim() ? Math.max(1, Number.parseInt(capacity, 10)) : undefined,
      recurrence_rule: {
        frequency: recurrenceFreq,
        interval: Math.max(1, Number.parseInt(recurrenceInterval || "1", 10)),
        daysOfWeek: recurrenceFreq === "weekly"
          ? Array.from(new Set(recurrenceDays.map((d) => localWeekdayToUtc(d, anchorIso)))).sort((a, b) => a - b)
          : undefined,
        dayOfMonth: recurrenceFreq === "monthly" ? Math.max(1, Math.min(31, Number.parseInt(recurrenceMonthDay || "1", 10))) : undefined,
        endAfter: recurrenceEndMode === "count" ? Math.max(1, Number.parseInt(recurrenceEndCount || "1", 10)) : undefined,
        endDate: recurrenceEndMode === "date" && recurrenceEndDate.trim() ? new Date(recurrenceEndDate).toISOString() : undefined,
      },
      visibility_offset_minutes: totalOffsetMinutes > 0 ? totalOffsetMinutes : undefined,
      auto_archive: autoArchive,
      /* 切成投票/抽奖时控件只是藏了，状态还在；这两种类型带着配额会被服务端整个拒收。 */
      class_quotas: eventType === "poll" || eventType === "raffle" ? [] : classQuotas,
    });
  }, [
    startTime, durationValue, durationUnit, title, description, eventType, capacity, classQuotas,
    recurrenceFreq, recurrenceInterval, recurrenceDays, recurrenceMonthDay,
    recurrenceEndMode, recurrenceEndDate, recurrenceEndCount,
    visibilityOffsetDays, visibilityOffsetHours, visibilityOffsetMinutes, autoArchive, onSave, t,
  ]);

  const lifecycle = useMemo(
    () => computeNextLifecyclePreview(formState, template, mode),
    [formState, template, mode],
  );

  const isPaused = mode === "edit" && (template?.paused ?? false);
  const locale = i18n?.language ?? "en";
  const isSaveDisabled = !title.trim() || !startTime || !eventType;

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
          {/* ═══════ Left Column ═══════ */}
          <div className="rtf-col">
            {/* Event Details */}
            <div>
              <div className="rtf-divider">
                <span className="rtf-divider__label">{t("recurring.section.details")}</span>
              </div>
              <Stack gap={12} className="rtf-section">
                <TextInput
                  label={t("field.title")}
                  value={title}
                  onChange={(event) => {
                    const val = event.currentTarget.value;
                    setFormState((current) => ({ ...current, title: val }));
                  }}
                  placeholder={t("field.title")}
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
                />
                <Textarea
                  label={t("field.description")}
                  value={description}
                  onChange={(event) => {
                    const val = event.currentTarget.value;
                    setFormState((current) => ({ ...current, description: val }));
                  }}
                  minRows={2}
                  autosize
                  maxRows={5}
                  placeholder={t("field.description")}
                />
              </Stack>
            </div>

            {/* Options */}
            <div>
              <div className="rtf-divider">
                <span className="rtf-divider__label">{t("recurring.section.options")}</span>
              </div>
              <Stack gap={12} className="rtf-section">
                <div>
                  <Text size="sm" fw={500} mb={4}>{t("recurring.field.visibilityOffset")}</Text>
                  {/* 三个框只靠 suffix 区分，共用上面那行标题——标题不是它们任何一个的
                      无障碍名，读屏和自动化都只能听到「一个数字输入框」乘以三。
                      各自补一个带单位的 aria-label，可见外观不变。 */}
                  <Group gap={8} wrap="nowrap">
                    <NumberInput
                      aria-label={t("recurring.field.visibilityOffsetUnit", { unit: t("recurring.field.durationUnit.days") })}
                      value={visibilityOffsetDays}
                      onChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          visibilityOffsetDays: typeof value === "number" ? value : "",
                        }))
                      }
                      min={0}
                      hideControls
                      suffix={` ${t("recurring.field.durationUnit.days").toLowerCase()}`}
                      style={{ flex: 1 }}
                    />
                    <NumberInput
                      aria-label={t("recurring.field.visibilityOffsetUnit", { unit: t("recurring.field.durationUnit.hours") })}
                      value={visibilityOffsetHours}
                      onChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          visibilityOffsetHours: typeof value === "number" ? value : "",
                        }))
                      }
                      min={0}
                      max={23}
                      hideControls
                      suffix={` ${t("recurring.field.durationUnit.hours").toLowerCase()}`}
                      style={{ flex: 1 }}
                    />
                    <NumberInput
                      aria-label={t("recurring.field.visibilityOffsetUnit", { unit: t("recurring.field.durationUnit.minutes") })}
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
                </div>
                <Switch
                  checked={autoArchive}
                  onChange={(event) => {
                    const val = event.currentTarget.checked;
                    setFormState((current) => ({ ...current, autoArchive: val }));
                  }}
                  label={t("field.autoArchive")}
                  description={t("field.autoArchiveHint")}
                />
              </Stack>
            </div>

            {/* Lifecycle Preview */}
            <div className={`rtf-lifecycle${lifecycle ? "" : " rtf-lifecycle--empty"}`}>
              <div className="rtf-lifecycle__title">
                <CalendarRepeatIcon size={16} className="rtf-lifecycle__title-icon" />
                <span>{t("recurring.lifecycle.title")}</span>
              </div>
              {lifecycle ? (
                <div className="rtf-lifecycle__steps">
                  <div className="rtf-lifecycle__step">
                    <span className="rtf-lifecycle__step-label">{t("recurring.lifecycle.creation")}</span>
                    <span className="rtf-lifecycle__step-value">{formatLifecycleDate(lifecycle.creationTime, locale)}</span>
                  </div>
                  <div className="rtf-lifecycle__step">
                    <span className="rtf-lifecycle__step-label">{t("recurring.lifecycle.start")}</span>
                    <span className="rtf-lifecycle__step-value">{formatLifecycleDate(lifecycle.startTime, locale)}</span>
                  </div>
                  {lifecycle.endTime && (
                    <div className="rtf-lifecycle__step">
                      <span className="rtf-lifecycle__step-label">{t("recurring.lifecycle.end")}</span>
                      <span className="rtf-lifecycle__step-value">{formatLifecycleDate(lifecycle.endTime, locale)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="rtf-lifecycle__empty-text">{t("recurring.lifecycle.empty")}</span>
              )}
            </div>
          </div>

          {/* ═══════ Right Column ═══════ */}
          <div className="rtf-col">
            {/* Schedule & Recurrence */}
            <div>
              <div className="rtf-divider">
                <span className="rtf-divider__label">{t("recurring.section.scheduleAndRecurrence")}</span>
              </div>
              <Stack gap={14} className="rtf-section">
                <NativeDateTimeInput
                  label={t("recurring.field.startTime")}
                  type="time"
                  value={startTime}
                  onChange={(event) => {
                    const val = event.currentTarget.value;
                    setFormState((current) => ({ ...current, startTime: val }));
                  }}
                />
                <Group gap={8} align="flex-end" wrap="nowrap">
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
                    aria-label={t("recurring.field.durationUnitLabel")}
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
                <TextInput
                  label={t("field.capacity")}
                  type="number"
                  value={capacity}
                  onChange={(event) => {
                    const val = event.currentTarget.value;
                    setFormState((current) => ({ ...current, capacity: val }));
                  }}
                  placeholder={t("field.unlimited")}
                  style={{ maxWidth: 160 }}
                />

                {/* 投票和抽奖没有阵容可言，服务端也拒收它们的配额。 */}
                {eventType !== "poll" && eventType !== "raffle" ? (
                  <ClassQuotaEditor
                    value={classQuotas}
                    onChange={(next) => setFormState((current) => ({ ...current, classQuotas: next }))}
                  />
                ) : null}

                <div className="rtf-recurrence-divider" />

                <div className="rtf-interval-row">
                  {/* 可见的「每」只是一个 span，不是任何控件的标签；两个控件都得自报名字。 */}
                  <span className="rtf-interval-label">{t("field.interval")}</span>
                  <TextInput
                    aria-label={t("field.interval")}
                    type="number"
                    value={recurrenceInterval}
                    onChange={(event) => {
                      const val = event.currentTarget.value;
                      setFormState((current) => ({
                        ...current,
                        recurrenceInterval: val,
                      }));
                    }}
                    style={{ width: 72 }}
                    min={1}
                  />
                  <Select
                    aria-label={t("recurring.field.frequency")}
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
                </div>

                {recurrenceFreq === "weekly" ? (
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>{t("field.weekdays")}</Text>
                    <div className="rtf-weekday-grid">
                      {WEEKDAY_KEYS.map((key, index) => {
                        const isSelected = recurrenceDays.includes(index);
                        return (
                          <button
                            key={key}
                            type="button"
                            // 选中与否此前只体现在 class 上：读屏听不出来，测试也只能去比 class。
                            aria-pressed={isSelected}
                            className={`rtf-weekday-btn${isSelected ? " rtf-weekday-btn--selected" : ""}`}
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
                          >
                            {t(key)}
                          </button>
                        );
                      })}
                    </div>
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
                        <NativeDateTimeInput
                          aria-label={t("recurrence.endDate")}
                          value={recurrenceEndDate}
                          onChange={(event) => {
                            const val = event.currentTarget.value;
                            setFormState((current) => ({
                              ...current,
                              recurrenceEndDate: val,
                            }));
                          }}
                          disabled={recurrenceEndMode !== "date"}
                          style={{ width: 170 }}
                        />
                      </Group>
                      <Group gap={8} align="center">
                        <Radio value="count" label={t("recurrence.endAfterLabel")} />
                        <TextInput
                          aria-label={t("recurring.field.endAfterCount")}
                          type="number"
                          value={recurrenceEndCount}
                          onChange={(event) => {
                            const val = event.currentTarget.value;
                            setFormState((current) => ({
                              ...current,
                              recurrenceEndCount: val,
                            }));
                          }}
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
          </div>
        </div>

        {/* ═══════ Actions (full width) ═══════ */}
        <div className="rtf-actions-divider" />
        <Group justify={mode === "edit" ? "space-between" : "flex-end"} wrap="wrap" gap={8}>
          {mode === "edit" && template && (
            <Group gap={8}>
              {template.paused ? (
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
                  color="orange"
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
