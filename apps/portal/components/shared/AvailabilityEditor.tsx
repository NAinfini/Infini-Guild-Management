import { ActionIcon, Badge, Button, Group, Menu, Popover, Select, Stack, Text } from "@mantine/core";
import { PlusIcon, XIcon } from "@portal/components/icons";
/* 静态图标。components/icons 里的 ChevronDownIcon 会给最近的可交互祖先挂
   mouseenter/mouseleave 来驱动 motion 动画；放进 Menu.Target 里会把刚打开的
   菜单又关掉（AvailabilityEditor.test.tsx 的复制用例可复现）。 */
import { IconChevronDown } from "@tabler/icons-react";
import {
  AVAILABILITY_DAY_KEYS,
  availabilityFromWindows,
  availabilityToWindows,
  type AvailabilityDayKey,
  type AvailabilityWindow,
  type MemberAvailability,
} from "@guild/shared";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export type DayKey = AvailabilityDayKey;

export type TimeBlock = {
  start: string;
  end: string;
};

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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

export type DayBlocks = Record<DayKey, TimeBlock[]>;

function emptyDays(): DayBlocks {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

/**
 * 排序并合并重叠或相接的时段。合并是必需的：预设会往已有时段上叠加，不合并就会
 * 在同一天里排出「20:00–24:00」和「22:00–24:00」两条，读的人无法判断哪条算数。
 */
function normalizeBlocks(blocks: TimeBlock[]): TimeBlock[] {
  const sorted = blocks
    .map((block) => ({ start: timeToMinutes(block.start), end: timeToMinutes(block.end) }))
    .filter((block) => block.end > block.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }
  return merged.map((block) => ({
    start: minutesToTime(block.start),
    end: minutesToTime(block.end),
  }));
}

const WEEK_MINUTES = 7 * DAY_MINUTES;

function wrapWeekMinute(value: number): number {
  return ((value % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
}

function shiftWindows(windows: readonly AvailabilityWindow[], deltaMinutes: number): AvailabilityWindow[] {
  const shifted: AvailabilityWindow[] = [];
  for (const window of windows) {
    let cursor = wrapWeekMinute(window.weekday * DAY_MINUTES + window.startMinute + deltaMinutes);
    let remaining = window.endMinute - window.startMinute;
    while (remaining > 0) {
      const weekday = Math.floor(cursor / DAY_MINUTES);
      const startMinute = cursor % DAY_MINUTES;
      const duration = Math.min(remaining, DAY_MINUTES - startMinute);
      shifted.push({ weekday, startMinute, endMinute: startMinute + duration });
      remaining -= duration;
      cursor = wrapWeekMinute(cursor + duration);
    }
  }

  const merged: AvailabilityWindow[] = [];
  for (const window of shifted.sort(
    (left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute,
  )) {
    const previous = merged[merged.length - 1];
    if (previous && previous.weekday === window.weekday && window.startMinute <= previous.endMinute) {
      previous.endMinute = Math.max(previous.endMinute, window.endMinute);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function localBlocksToWindows(days: DayBlocks): AvailabilityWindow[] {
  return DAYS.flatMap((day) => days[day].map((block) => ({
    weekday: AVAILABILITY_DAY_KEYS.indexOf(day),
    startMinute: timeToMinutes(block.start),
    endMinute: timeToMinutes(block.end),
  })));
}

export function convertLocalDaysToAvailability(
  days: DayBlocks,
  timezone: string,
  offsetMinutes: number,
): MemberAvailability | null {
  const localWindows = localBlocksToWindows(days);
  if (localWindows.length === 0) return null;
  return availabilityFromWindows(timezone, shiftWindows(localWindows, offsetMinutes));
}

export function convertAvailabilityToLocalDays(
  availability: MemberAvailability | null,
  offsetMinutes: number,
): DayBlocks {
  const days = emptyDays();
  if (availability === null) return days;
  for (const window of shiftWindows(availabilityToWindows(availability), -offsetMinutes)) {
    const day = AVAILABILITY_DAY_KEYS[window.weekday]!;
    days[day].push({
      start: minutesToTime(window.startMinute),
      end: minutesToTime(window.endMinute),
    });
  }
  for (const day of DAYS) days[day] = normalizeBlocks(days[day]);
  return days;
}

/* UTC day keys are the API and D1 contract. The editor shows local clock rows,
 * so conversion moves both the minute and weekday and splits at day boundaries. */
export function AvailabilityEditor({ value, onChange }: AvailabilityEditorProps) {
  const { t } = useTranslation("profile");
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const offsetMinutes = useMemo(() => new Date().getTimezoneOffset(), []);
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

  return (
    <Stack gap="var(--space-md)" w="100%">
      <Group gap="var(--space-sm)" justify="space-between" wrap="wrap">
        <Group gap="var(--space-sm)">
          <Text c="dimmed" size="sm">
            {t("availability.editor.timezoneNote")}
          </Text>
          <Badge variant="default">{timezone}</Badge>
        </Group>
        <Button size="compact-xs" variant="default" onClick={() => commit(emptyDays())}>
          {t("availability.editor.clearAll")}
        </Button>
      </Group>

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
                    <ActionIcon
                      variant="subtle"
                      size={20}
                      aria-label={t("availability.editor.removeBlock", {
                        day: t(DAY_LABEL_KEYS[day]),
                        start: block.start,
                        end: block.end,
                      })}
                      onClick={() => removeBlock(day, index)}
                    >
                      <XIcon size={12} />
                    </ActionIcon>
                  </span>
                ))
              )}

              <Popover
                opened={pickerDay === day}
                onChange={(opened) => {
                  if (!opened) setPickerDay(null);
                }}
                position="bottom-start"
                withArrow
                trapFocus
              >
                <Popover.Target>
                  <button
                    type="button"
                    className="availability-day__add"
                    aria-label={t("availability.editor.addBlock", {
                      day: t(DAY_LABEL_KEYS[day]),
                    })}
                    onClick={() => (pickerDay === day ? setPickerDay(null) : openPicker(day))}
                  >
                    <PlusIcon size={14} />
                  </button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Group gap="var(--space-sm)" align="flex-end" wrap="nowrap">
                    {/*
                      两个下拉都必须留在弹层内部（withinPortal: false）。
                      Select 的下拉默认 portal 到 body，落在 Popover 的节点之外，
                      于是选一个时间点会被 Popover 判成「点了外面」——选完约半秒后
                      整个弹层自己消失，自定义时段根本加不进去，只有一动不动直接点
                      「Add」用默认的 20:00–24:00 才成。
                    */}
                    <Select
                      w={104}
                      label={t("availability.editor.start")}
                      data={startOptions}
                      value={draftStart}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: false }}
                      onChange={(next) => {
                        if (next) setDraftStart(next);
                      }}
                    />
                    <Select
                      w={104}
                      label={t("availability.editor.end")}
                      data={endOptions}
                      value={draftEnd}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: false }}
                      onChange={(next) => {
                        if (next) setDraftEnd(next);
                      }}
                    />
                    <Button size="sm" disabled={!draftValid} onClick={confirmAdd}>
                      {t("availability.editor.confirmAdd")}
                    </Button>
                  </Group>
                  {/* 结束早于开始时禁用按钮并说明原因，而不是替用户把两个值调个个儿。 */}
                  {draftValid ? null : (
                    <Text size="xs" c="dimmed" mt="var(--space-xs)">
                      {t("availability.editor.endAfterStart")}
                    </Text>
                  )}
                </Popover.Dropdown>
              </Popover>
            </div>

            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <button
                  type="button"
                  className="availability-day__copy"
                  disabled={days[day].length === 0}
                >
                  {t("availability.editor.copyTo")}
                  <IconChevronDown size={13} stroke={2} />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                {DAYS.filter((target) => target !== day).map((target) => (
                  <Menu.Item key={target} onClick={() => copyDay(day, target)}>
                    {t(DAY_LABEL_KEYS[target])}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          </div>
        ))}
      </div>
    </Stack>
  );
}
