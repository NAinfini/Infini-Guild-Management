import { ActionIcon, Badge, Button, Group, Menu, Popover, Select, Stack, Text } from "@mantine/core";
import { PlusIcon, XIcon } from "@portal/components/icons";
/* 静态图标。components/icons 里的 ChevronDownIcon 会给最近的可交互祖先挂
   mouseenter/mouseleave 来驱动 motion 动画；放进 Menu.Target 里会把刚打开的
   菜单又关掉（AvailabilityEditor.test.tsx 的复制用例可复现）。 */
import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type TimeBlock = {
  start: string;
  end: string;
};

export type AvailabilityPayload = {
  timezone: string;
  days: Record<DayKey, Array<{ start_utc: string; end_utc: string }>>;
};

type AvailabilityEditorProps = {
  value: Record<string, unknown> | null;
  onChange: (next: { availability: AvailabilityPayload }) => void;
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

function localTimeToUtc(localTime: string): string {
  const [hours, minutes] = localTime.split(":").map((v) => Number.parseInt(v, 10));
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function utcTimeToLocal(utcTime: string): string {
  const [hours, minutes] = utcTime.split(":").map((v) => Number.parseInt(v, 10));
  const date = new Date();
  date.setUTCHours(hours || 0, minutes || 0, 0, 0);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

type DayBlocks = Record<DayKey, TimeBlock[]>;

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

function parseValue(value: Record<string, unknown> | null): DayBlocks {
  const days = emptyDays();
  if (!value || typeof value !== "object") return days;
  const raw = value.days;
  if (!raw || typeof raw !== "object") return days;

  for (const day of DAYS) {
    const list = (raw as Record<string, unknown>)[day];
    if (!Array.isArray(list)) continue;
    const blocks: TimeBlock[] = [];
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const startUtc = typeof row.start_utc === "string" ? row.start_utc : null;
      const endUtc = typeof row.end_utc === "string" ? row.end_utc : null;
      if (!startUtc || !endUtc) continue;
      const start = utcTimeToLocal(startUtc);
      const end = utcTimeToLocal(endUtc);
      /*
       * 结束时间落回本地时会跨过午夜：UTC+8 的「20:00–24:00」存成 12:00–16:00 UTC，
       * 读回来结束是次日 00:00，时钟上写作 "00:00"。当天的一段时间不可能结束得
       * 比开始还早，所以这里的 00:00 只可能是当天的 24:00。不还原的话
       * normalizeBlocks 会把 end <= start 当成无效范围，因此午夜要恢复成 24:00。
       */
      const endMinutes = timeToMinutes(end);
      blocks.push({
        start,
        end: endMinutes <= timeToMinutes(start) ? minutesToTime(DAY_MINUTES) : end,
      });
    }
    days[day] = normalizeBlocks(blocks);
  }
  return days;
}

function toPayload(days: DayBlocks): AvailabilityPayload {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const payloadDays = {} as AvailabilityPayload["days"];
  for (const day of DAYS) {
    payloadDays[day] = days[day].map((block) => ({
      start_utc: localTimeToUtc(block.start),
      end_utc: localTimeToUtc(block.end),
    }));
  }
  return { timezone, days: payloadDays };
}

/*
 * Weekly availability maps one-to-one to stored time ranges. A range cannot
 * cross midnight because persistence is partitioned by day; split it across
 * adjacent days instead.
 */
export function AvailabilityEditor({ value, onChange }: AvailabilityEditorProps) {
  const { t } = useTranslation("profile");
  const [days, setDays] = useState<DayBlocks>(() => parseValue(value));
  const [pickerDay, setPickerDay] = useState<DayKey | null>(null);
  const [draftStart, setDraftStart] = useState("20:00");
  const [draftEnd, setDraftEnd] = useState("24:00");

  useEffect(() => {
    setDays(parseValue(value));
  }, [value]);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

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
    onChange({ availability: toPayload(next) });
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
