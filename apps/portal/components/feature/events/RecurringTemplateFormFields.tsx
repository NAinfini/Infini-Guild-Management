import { Group, NumberInput, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_GAME_RULES, EVENT_TYPES, type EventType } from "@guild/shared";
import { ClassQuotaEditor } from "./ClassQuotaEditor";
import {
  WEEKDAY_KEYS,
  type DurationUnit,
  type RecurrenceEndMode,
  type RecurrenceFreq,
  type RecurringTemplateFormState,
} from "./RecurringTemplateFormModal.helpers";
import { eventHasBehavior, getEventTypeLabel } from "@portal/utils/game-rules";

/*
 * 模板表单的两段：生成什么，什么时候生成。
 *
 * 以前是「活动信息／选项／时间与重复」三段散在两栏里：容量在右栏的时间段落里，
 * 自动归档在左栏的选项段落里，可见提前量也在左栏——同样是在描述那张将要被生成的
 * 活动长什么样，却隔着一整栏。现在只问两件事，字段一个没删，只是各归各位。
 *
 * 这两段各占一栏（见 RecurringTemplateFormModal）：挤在同一栏时那一栏有十几个控件
 * 要自己滚，隔壁只放一张预览卡，看着就是一边塞满一边空着。
 */
type FormFieldsProps = {
  formState: RecurringTemplateFormState;
  setFormState: Dispatch<SetStateAction<RecurringTemplateFormState>>;
};

export function RecurringTemplateProducesFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");

  return (
    <div>
      <div className="rtf-divider">
        <span className="rtf-divider__label">{t("recurring.section.produces")}</span>
      </div>
      <Stack gap={12} className="rtf-section">
        <ProducesFields formState={formState} setFormState={setFormState} />
      </Stack>
    </div>
  );
}

export function RecurringTemplateTimingFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");

  return (
    <div>
      <div className="rtf-divider">
        <span className="rtf-divider__label">{t("recurring.section.timing")}</span>
      </div>
      <Stack gap={14} className="rtf-section">
        <TimingFields formState={formState} setFormState={setFormState} />
      </Stack>
    </div>
  );
}

function ProducesFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const gameRules = DEFAULT_GAME_RULES;
  const { title, eventType, description, capacity, classQuotas, autoArchive } = formState;

  return (
    <>
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
          eventType: value && EVENT_TYPES.includes(value as EventType) ? value as EventType : "",
          }))
        }
        data={gameRules.events.types
          .filter((definition) => definition.enabled)
          .map((definition) => ({
            value: definition.id,
            label: getEventTypeLabel(definition.id),
          }))}
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
      {!eventHasBehavior(eventType, "poll", gameRules) && !eventHasBehavior(eventType, "raffle", gameRules) ? (
        <ClassQuotaEditor
          value={classQuotas}
          onChange={(next) => setFormState((current) => ({ ...current, classQuotas: next }))}
        />
      ) : null}

      <Switch
        checked={autoArchive}
        onChange={(event) => {
          const val = event.currentTarget.checked;
          setFormState((current) => ({ ...current, autoArchive: val }));
        }}
        label={t("field.autoArchive")}
        description={t("field.autoArchiveHint")}
      />
    </>
  );
}

function TimingFields({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const { startTime, durationValue, durationUnit, recurrenceFreq, recurrenceInterval, recurrenceMonthDay } = formState;

  return (
    <>
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
            setFormState((current) => ({ ...current, recurrenceInterval: val }));
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
        <WeekdayPicker formState={formState} setFormState={setFormState} />
      ) : null}

      {recurrenceFreq === "monthly" ? (
        <Select
          label={t("field.monthDay")}
          value={recurrenceMonthDay}
          onChange={(value) =>
            value &&
            setFormState((current) => ({ ...current, recurrenceMonthDay: value }))
          }
          data={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          style={{ width: 100 }}
        />
      ) : null}

      <EndConditionField formState={formState} setFormState={setFormState} />

      <div className="rtf-recurrence-divider" />

      <VisibilityOffsetField formState={formState} setFormState={setFormState} />
    </>
  );
}

function WeekdayPicker({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{t("field.weekdays")}</Text>
      <div className="rtf-weekday-grid">
        {WEEKDAY_KEYS.map((key, index) => {
          const isSelected = formState.recurrenceDays.includes(index);
          return (
            <button
              key={key}
              type="button"
              // 选中与否此前只体现在 class 上：读屏听不出来，测试也只能去比 class。
              aria-pressed={isSelected}
              className={`rtf-weekday-btn${isSelected ? " rtf-weekday-btn--selected" : ""}`}
              onClick={() =>
                setFormState((current) => ({
                  ...current,
                  recurrenceDays: isSelected
                    ? current.recurrenceDays.filter((d) => d !== index)
                    : [...current.recurrenceDays, index],
                }))
              }
            >
              {t(key)}
            </button>
          );
        })}
      </div>
    </Stack>
  );
}

/*
 * 结束条件以前是三个单选加两个输入框，没选中的那两个框灰着摆在那儿——两行永远无效的
 * 控件，还占着位置。现在先选一种结束方式，再填那一种要的那一个值；「永不」什么都不用填。
 */
function EndConditionField({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const { recurrenceEndMode, recurrenceEndDate, recurrenceEndCount } = formState;

  return (
    <Stack gap={8}>
      <Select
        label={t("recurrence.endLabel")}
        value={recurrenceEndMode}
        onChange={(value) =>
          value &&
          setFormState((current) => ({ ...current, recurrenceEndMode: value as RecurrenceEndMode }))
        }
        data={[
          { value: "never", label: t("recurrence.endNever") },
          { value: "date", label: t("recurrence.endMode.date") },
          { value: "count", label: t("recurrence.endMode.count") },
        ]}
        allowDeselect={false}
        style={{ maxWidth: 220 }}
      />
      {recurrenceEndMode === "date" ? (
        <NativeDateTimeInput
          aria-label={t("recurrence.endDate")}
          value={recurrenceEndDate}
          onChange={(event) => {
            const val = event.currentTarget.value;
            setFormState((current) => ({ ...current, recurrenceEndDate: val }));
          }}
          style={{ width: 170 }}
        />
      ) : null}
      {recurrenceEndMode === "count" ? (
        <Group gap={8} align="center" wrap="nowrap">
          <TextInput
            aria-label={t("recurring.field.endAfterCount")}
            type="number"
            value={recurrenceEndCount}
            onChange={(event) => {
              const val = event.currentTarget.value;
              setFormState((current) => ({ ...current, recurrenceEndCount: val }));
            }}
            style={{ width: 72 }}
            min={1}
          />
          <Text size="sm" c="dimmed">{t("recurrence.endAfterSuffix")}</Text>
        </Group>
      ) : null}
    </Stack>
  );
}

function VisibilityOffsetField({ formState, setFormState }: FormFieldsProps) {
  const { t } = useTranslation("events");
  const { visibilityOffsetDays, visibilityOffsetHours, visibilityOffsetMinutes } = formState;

  /* 三个框只靠 suffix 区分，共用上面那行标题——标题不是它们任何一个的无障碍名，
     读屏和自动化都只能听到「一个数字输入框」乘以三。各自补一个带单位的 aria-label。 */
  const unitLabel = (unit: string) =>
    t("recurring.field.visibilityOffsetUnit", { unit: t(`recurring.field.durationUnit.${unit}`) });

  return (
    <div>
      <Text size="sm" fw={500} mb={4}>{t("recurring.field.visibilityOffset")}</Text>
      <Group gap={8} wrap="nowrap">
        <NumberInput
          aria-label={unitLabel("days")}
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
          aria-label={unitLabel("hours")}
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
          aria-label={unitLabel("minutes")}
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
  );
}
