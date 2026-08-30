import { DEFAULT_GAME_RULES, EVENT_TYPES, type EventType } from "@guild/shared";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Switch } from "@portal/components/ui/switch";
import { Textarea } from "@portal/components/ui/textarea";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ClassQuotaEditor } from "./ClassQuotaEditor";
import {
  WEEKDAY_KEYS,
  type DurationUnit,
  type RecurrenceEndMode,
  type RecurrenceFreq,
  type RecurringTemplateFormState,
} from "./RecurringTemplateForm.helpers";
import { eventHasBehavior, getEventTypeLabel } from "@portal/utils/game-rules";

type FormFieldsProps = {
  formState: RecurringTemplateFormState;
  setFormState: Dispatch<SetStateAction<RecurringTemplateFormState>>;
};

export function RecurringTemplateProducesFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  return (
    <div>
      <div className="rtf-divider"><span className="rtf-divider__label">{t("recurring.section.produces")}</span></div>
      <div className="rtf-section rtf-field-stack"><ProducesFields formState={formState} setFormState={setFormState} /></div>
    </div>
  );
}

export function RecurringTemplateTimingFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  return (
    <div>
      <div className="rtf-divider"><span className="rtf-divider__label">{t("recurring.section.timing")}</span></div>
      <div className="rtf-section rtf-field-stack"><TimingFields formState={formState} setFormState={setFormState} /></div>
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  className,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`rtf-field${className ? ` ${className}` : ""}`}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)} className="rtf-select">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function ProducesFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const { title, eventType, description, capacity, classQuotas, autoArchive } = formState;
  const eventTypeOptions = [
    { value: "", label: t("recurring.field.typePlaceholder") },
    ...DEFAULT_GAME_RULES.events.types
      .filter((definition) => definition.enabled)
      .map((definition) => ({ value: definition.id, label: getEventTypeLabel(definition.id) })),
  ];

  return (
    <>
      <div className="rtf-field"><Label htmlFor="recurring-template-title">{t("field.title")}</Label><Input id="recurring-template-title" value={title} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, title: value })); }} placeholder={t("field.title")} /></div>
      <SelectField id="recurring-template-type" label={t("filter.type")} value={eventType} onChange={(value) => setFormState((current) => ({ ...current, eventType: value && EVENT_TYPES.includes(value as EventType) ? value as EventType : "" }))} options={eventTypeOptions} />
      <div className="rtf-field"><Label htmlFor="recurring-template-description">{t("field.description")}</Label><Textarea id="recurring-template-description" value={description} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, description: value })); }} rows={4} placeholder={t("field.description")} /></div>
      <div className="rtf-field rtf-field--narrow"><Label htmlFor="recurring-template-capacity">{t("field.capacity")}</Label><Input id="recurring-template-capacity" type="number" value={capacity} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, capacity: value })); }} placeholder={t("field.unlimited")} /></div>
      {!eventHasBehavior(eventType, "poll") && !eventHasBehavior(eventType, "raffle") ? <ClassQuotaEditor value={classQuotas} onChange={(next) => setFormState((current) => ({ ...current, classQuotas: next }))} /> : null}
      <Label className="rtf-switch-field"><Switch checked={autoArchive} onCheckedChange={(autoArchive) => setFormState((current) => ({ ...current, autoArchive }))} /><span><strong>{t("field.autoArchive")}</strong><small>{t("field.autoArchiveHint")}</small></span></Label>
    </>
  );
}

function TimingFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const { startTime, durationValue, durationUnit, recurrenceFreq, recurrenceInterval, recurrenceMonthDay } = formState;
  return (
    <>
      <NativeDateTimeInput label={t("recurring.field.startTime")} type="time" value={startTime} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, startTime: value })); }} />
      <div className="rtf-duration-row">
        <div className="rtf-field"><Label htmlFor="recurring-template-duration">{t("recurring.field.duration")}</Label><Input id="recurring-template-duration" type="number" min={0} value={String(durationValue)} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, durationValue: Number.parseInt(value, 10) || 0 })); }} /></div>
        <SelectField id="recurring-template-duration-unit" label={t("recurring.field.durationUnitLabel")} value={durationUnit} onChange={(value) => setFormState((current) => ({ ...current, durationUnit: value as DurationUnit }))} options={[{ value: "minutes", label: t("recurring.field.durationUnit.minutes") }, { value: "hours", label: t("recurring.field.durationUnit.hours") }]} />
      </div>
      <div className="rtf-recurrence-divider" />
      <div className="rtf-interval-row">
        <span className="rtf-interval-label">{t("field.interval")}</span>
        <Input aria-label={t("field.interval")} type="number" value={recurrenceInterval} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, recurrenceInterval: value })); }} className="rtf-input--short" min={1} />
        <select aria-label={t("recurring.field.frequency")} value={recurrenceFreq} onChange={(event) => { const value = event.currentTarget.value as RecurrenceFreq; setFormState((current) => ({ ...current, recurrenceFreq: value })); }} className="rtf-select rtf-select--frequency"><option value="daily">{t("recurrence.freqDay")}</option><option value="weekly">{t("recurrence.freqWeek")}</option><option value="monthly">{t("recurrence.freqMonth")}</option></select>
      </div>
      {recurrenceFreq === "weekly" ? <WeekdayPicker formState={formState} setFormState={setFormState} /> : null}
      {recurrenceFreq === "monthly" ? <SelectField id="recurring-template-month-day" label={t("field.monthDay")} value={recurrenceMonthDay} onChange={(value) => setFormState((current) => ({ ...current, recurrenceMonthDay: value }))} options={Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} className="rtf-field--narrow" /> : null}
      <EndConditionField formState={formState} setFormState={setFormState} />
      <div className="rtf-recurrence-divider" />
      <VisibilityOffsetField formState={formState} setFormState={setFormState} />
    </>
  );
}

function WeekdayPicker({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  return <div className="rtf-field-stack"><strong>{t("field.weekdays")}</strong><div className="rtf-weekday-grid">{WEEKDAY_KEYS.map((key, index) => {
    const isSelected = formState.recurrenceDays.includes(index);
    return <button key={key} type="button" aria-pressed={isSelected} className={`rtf-weekday-btn${isSelected ? " rtf-weekday-btn--selected" : ""}`} onClick={() => setFormState((current) => ({ ...current, recurrenceDays: isSelected ? current.recurrenceDays.filter((day) => day !== index) : [...current.recurrenceDays, index] }))}>{t(key)}</button>;
  })}</div></div>;
}

function EndConditionField({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const { recurrenceEndMode, recurrenceEndDate, recurrenceEndCount } = formState;
  return <div className="rtf-field-stack">
    <SelectField id="recurring-template-end-mode" label={t("recurrence.endLabel")} value={recurrenceEndMode} onChange={(value) => setFormState((current) => ({ ...current, recurrenceEndMode: value as RecurrenceEndMode }))} options={[{ value: "never", label: t("recurrence.endNever") }, { value: "date", label: t("recurrence.endMode.date") }, { value: "count", label: t("recurrence.endMode.count") }]} className="rtf-field--end-mode" />
    {recurrenceEndMode === "date" ? <NativeDateTimeInput aria-label={t("recurrence.endDate")} value={recurrenceEndDate} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, recurrenceEndDate: value })); }} className="rtf-input--date" /> : null}
    {recurrenceEndMode === "count" ? <div className="rtf-end-count-row"><Input aria-label={t("recurring.field.endAfterCount")} type="number" value={recurrenceEndCount} onChange={(event) => { const value = event.currentTarget.value; setFormState((current) => ({ ...current, recurrenceEndCount: value })); }} className="rtf-input--short" min={1} /><span>{t("recurrence.endAfterSuffix")}</span></div> : null}
  </div>;
}

function VisibilityOffsetField({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const unitLabel = (unit: string) => t("recurring.field.visibilityOffsetUnit", { unit: t(`recurring.field.durationUnit.${unit}`) });
  const update = (key: "visibilityOffsetDays" | "visibilityOffsetHours" | "visibilityOffsetMinutes", raw: string) => setFormState((current) => ({ ...current, [key]: raw === "" ? "" : Number.parseInt(raw, 10) || 0 }));
  return <div className="rtf-field-stack"><strong>{t("recurring.field.visibilityOffset")}</strong><div className="rtf-offset-row">
    <Input aria-label={unitLabel("days")} type="number" value={String(formState.visibilityOffsetDays)} onChange={(event) => update("visibilityOffsetDays", event.currentTarget.value)} min={0} />
    <Input aria-label={unitLabel("hours")} type="number" value={String(formState.visibilityOffsetHours)} onChange={(event) => update("visibilityOffsetHours", event.currentTarget.value)} min={0} max={23} />
    <Input aria-label={unitLabel("minutes")} type="number" value={String(formState.visibilityOffsetMinutes)} onChange={(event) => update("visibilityOffsetMinutes", event.currentTarget.value)} min={0} max={59} />
  </div></div>;
}
