import { PlusIcon, XIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { Label } from "@portal/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@portal/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@portal/components/ui/select";
import { IconChevronDown } from "@tabler/icons-react";
import { type AvailabilityDayKey, type MemberAvailability } from "@guild/shared";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  convertAvailabilityToLocalDays,
  convertLocalDaysToAvailability,
  emptyDays,
  minutesToTime,
  normalizeBlocks,
  timeToMinutes,
  type DayBlocks,
  type TimeBlock,
} from "@portal/utils/availability";
import { viewerTimeZone, viewerUtcOffsetMinutes } from "@portal/utils/datetime";
import "./AvailabilityEditor.css";

export type DayKey = AvailabilityDayKey;

export type AvailabilityPayload = MemberAvailability;

type AvailabilityEditorProps = {
  value: MemberAvailability | null;
  onChange: (next: { availability: MemberAvailability | null }) => void;
};

const DAYS: DayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_LABEL_KEYS: Record<DayKey, string> = {
  monday: "availability.editor.dayMon",
  tuesday: "availability.editor.dayTue",
  wednesday: "availability.editor.dayWed",
  thursday: "availability.editor.dayThu",
  friday: "availability.editor.dayFri",
  saturday: "availability.editor.daySat",
  sunday: "availability.editor.daySun",
};

const STEP_MINUTES = 30;
const DAY_MINUTES = 24 * 60;
const STEPS_PER_DAY = DAY_MINUTES / STEP_MINUTES;

/**
 * 预设描述的是「哪几天、什么时段」。套用时与已有时段合并而不是覆盖：先点
 * 「工作日晚上」再点「周末全天」，两样都该在。
 */
const PRESETS: Array<{ id: string; days: DayKey[]; block: TimeBlock }> = [
  {
    id: "weeknights",
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    block: { start: "20:00", end: "24:00" },
  },
  { id: "weekends", days: ["saturday", "sunday"], block: { start: "10:00", end: "24:00" } },
  { id: "everyEvening", days: DAYS, block: { start: "19:00", end: "23:00" } },
  { id: "lateNight", days: DAYS, block: { start: "00:00", end: "03:00" } },
];

/* UTC 的星期与时刻是 API 和 D1 的契约，编辑器排的是本地时钟行。换算住在
   utils/availability.ts，同一份作息在资料页和公会战详情里必须读出同一个时刻。 */
export function AvailabilityEditor({ value, onChange }: AvailabilityEditorProps) {
  const { t } = useTranslation("profile");
  const timezone = useMemo(() => viewerTimeZone(), []);
  const offsetMinutes = useMemo(() => viewerUtcOffsetMinutes(), []);
  const [days, setDays] = useState<DayBlocks>(() => convertAvailabilityToLocalDays(value, offsetMinutes));
  const [pickerDay, setPickerDay] = useState<DayKey | null>(null);
  const [draftStart, setDraftStart] = useState("20:00");
  const [draftEnd, setDraftEnd] = useState("24:00");

  useEffect(() => {
    setDays(convertAvailabilityToLocalDays(value, offsetMinutes));
  }, [offsetMinutes, value]);

  const startOptions = useMemo(
    () => Array.from({ length: STEPS_PER_DAY }, (_, index) => minutesToTime(index * STEP_MINUTES)),
    [],
  );
  /* 结束时间的可选值从 00:30 到 24:00：00:00 当结束、24:00 当开始都没有意义，
     所以两个下拉不是同一份列表。 */
  const endOptions = useMemo(
    () =>
      Array.from({ length: STEPS_PER_DAY }, (_, index) =>
        minutesToTime((index + 1) * STEP_MINUTES),
      ),
    [],
  );

  const commit = (next: DayBlocks) => {
    setDays(next);
    onChange({
      availability: convertLocalDaysToAvailability(next, timezone, offsetMinutes),
    });
  };

  const addBlock = (targetDays: DayKey[], block: TimeBlock) => {
    const next = { ...days };
    for (const day of targetDays) {
      next[day] = normalizeBlocks([...next[day], block]);
    }
    commit(next);
  };

  const removeBlock = (day: DayKey, index: number) => {
    commit({ ...days, [day]: days[day].filter((_, i) => i !== index) });
  };

  const copyDay = (from: DayKey, to: DayKey) => {
    commit({ ...days, [to]: normalizeBlocks([...days[to], ...days[from]]) });
  };

  const openPicker = (day: DayKey) => {
    setPickerDay(day);
    setDraftStart("20:00");
    setDraftEnd("24:00");
  };

  const confirmAdd = () => {
    if (!pickerDay) return;
    addBlock([pickerDay], { start: draftStart, end: draftEnd });
    setPickerDay(null);
  };

  const draftValid = timeToMinutes(draftEnd) > timeToMinutes(draftStart);

  const startItems = Object.fromEntries(startOptions.map((time) => [time, time]));
  const endItems = Object.fromEntries(endOptions.map((time) => [time, time]));

  return (
    <div className="availability-editor">
      <div className="availability-editor__header">
        <div className="availability-editor__timezone">
          <span>{t("availability.editor.timezoneNote")}</span>
          <Badge variant="secondary">{timezone}</Badge>
        </div>
        <Button size="xs" variant="outline" onClick={() => commit(emptyDays())}>
          {t("availability.editor.clearAll")}
        </Button>
      </div>

      <div className="availability-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="availability-preset"
            onClick={() => addBlock(preset.days, preset.block)}
          >
            {t(`availability.editor.preset.${preset.id}`)}
          </button>
        ))}
      </div>

      <div className="availability-days">
        {DAYS.map((day) => (
          <div key={day} className="availability-day">
            <span className="availability-day__name">{t(DAY_LABEL_KEYS[day])}</span>

            <div className="availability-day__blocks">
              {days[day].length === 0 ? (
                <span className="availability-day__empty">
                  {t("availability.editor.dayEmpty")}
                </span>
              ) : (
                days[day].map((block, index) => (
                  <span key={`${block.start}-${block.end}`} className="availability-block">
                    {block.start}–{block.end}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("availability.editor.removeBlock", {
                        day: t(DAY_LABEL_KEYS[day]),
                        start: block.start,
                        end: block.end,
                      })}
                      onClick={() => removeBlock(day, index)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </span>
                ))
              )}

              <Popover
                open={pickerDay === day}
                onOpenChange={(open) => {
                  if (open) openPicker(day);
                  else setPickerDay(null);
                }}
              >
                <PopoverTrigger
                  render={(
                    <button
                      type="button"
                      className="availability-day__add"
                      aria-label={t("availability.editor.addBlock", {
                        day: t(DAY_LABEL_KEYS[day]),
                      })}
                    />
                  )}
                >
                  <PlusIcon aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent align="start" className="availability-editor__picker">
                  <div className="availability-editor__picker-row">
                    <div className="availability-editor__select-field">
                      <Label>{t("availability.editor.start")}</Label>
                      <Select
                        items={startItems}
                        value={draftStart}
                        onValueChange={(next) => {
                          if (next) setDraftStart(next);
                        }}
                      >
                        <SelectTrigger aria-label={t("availability.editor.start")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {startOptions.map((time) => (
                            <SelectItem key={time} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="availability-editor__select-field">
                      <Label>{t("availability.editor.end")}</Label>
                      <Select
                        items={endItems}
                        value={draftEnd}
                        onValueChange={(next) => {
                          if (next) setDraftEnd(next);
                        }}
                      >
                        <SelectTrigger aria-label={t("availability.editor.end")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {endOptions.map((time) => (
                            <SelectItem key={time} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" disabled={!draftValid} onClick={confirmAdd}>
                      {t("availability.editor.confirmAdd")}
                    </Button>
                  </div>
                  {draftValid ? null : (
                    <p className="availability-editor__validation">
                      {t("availability.editor.endAfterStart")}
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={days[day].length === 0}
                render={(
                  <button
                    type="button"
                    className="availability-day__copy"
                  />
                )}
              >
                {t("availability.editor.copyTo")}
                <IconChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {DAYS.filter((target) => target !== day).map((target) => (
                  <DropdownMenuItem key={target} onClick={() => copyDay(day, target)}>
                    {t(DAY_LABEL_KEYS[target])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </div>
  );
}
