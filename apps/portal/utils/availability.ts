import {
  AVAILABILITY_DAY_KEYS,
  availabilityFromWindows,
  availabilityToWindows,
  type AvailabilityDayKey,
  type AvailabilityWindow,
  type MemberAvailability,
  type MemberAvailabilitySummary,
  type MemberProfile,
  type MemberSummary,
} from "@guild/shared";
import { wrapWeekMinute } from "./datetime";

export type AvailabilityMinuteRange = {
  startMinutes: number;
  endMinutes: number;
};

export type TimeBlock = {
  start: string;
  end: string;
};

export type DayBlocks = Record<AvailabilityDayKey, TimeBlock[]>;

const DAY_MINUTES = 24 * 60;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10));
  return (hours || 0) * 60 + (minutes || 0);
}

export function emptyDays(): DayBlocks {
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
export function normalizeBlocks(blocks: TimeBlock[]): TimeBlock[] {
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
  return AVAILABILITY_DAY_KEYS.flatMap((day, weekday) => days[day].map((block) => ({
    weekday,
    startMinute: timeToMinutes(block.start),
    endMinute: timeToMinutes(block.end),
  })));
}

/* UTC 的星期与时刻是 API 和 D1 的契约。本地视图要同时挪动时刻和星期，并在午夜处切断：
   UTC 周五 23:00–24:00 在 UTC+8 是周六 07:00–08:00，星期跟着走才不会读错。
   offsetMinutes 东为正，取自 datetime.ts 的 viewerUtcOffsetMinutes()。 */
export function convertAvailabilityToLocalDays(
  availability: MemberAvailability | null,
  offsetMinutes: number,
): DayBlocks {
  const days = emptyDays();
  if (availability === null) return days;
  for (const window of shiftWindows(availabilityToWindows(availability), offsetMinutes)) {
    days[AVAILABILITY_DAY_KEYS[window.weekday]!].push({
      start: minutesToTime(window.startMinute),
      end: minutesToTime(window.endMinute),
    });
  }
  for (const day of AVAILABILITY_DAY_KEYS) days[day] = normalizeBlocks(days[day]);
  return days;
}

export function convertLocalDaysToAvailability(
  days: DayBlocks,
  timezone: string,
  offsetMinutes: number,
): MemberAvailability | null {
  const localWindows = localBlocksToWindows(days);
  if (localWindows.length === 0) return null;
  return availabilityFromWindows(timezone, shiftWindows(localWindows, -offsetMinutes));
}

export type AvailabilityHeatData = {
  hourlyByDay: Map<number, number[]>;
  dayPeakByDay: Map<number, number>;
  daysWithAny: Set<number>;
  maxCount: number;
  memberCount: number;
};

export function buildAvailabilityHeatDataFromSummary(
  summary: MemberAvailabilitySummary | undefined,
): AvailabilityHeatData {
  const hourlyByDay = new Map<number, number[]>();
  const dayPeakByDay = new Map<number, number>();
  const daysWithAny = new Set<number>();
  let maxCount = 0;
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const counts = [...(summary?.hourly_counts[dayIndex] ?? createEmptyHourlyCounts())];
    const peak = counts.reduce((currentMax, value) => Math.max(currentMax, value), 0);
    hourlyByDay.set(dayIndex, counts);
    dayPeakByDay.set(dayIndex, peak);
    if (peak > 0) daysWithAny.add(dayIndex);
    maxCount = Math.max(maxCount, peak);
  }
  return {
    hourlyByDay,
    dayPeakByDay,
    daysWithAny,
    maxCount,
    memberCount: summary?.member_count ?? 0,
  };
}

type AvailabilityMemberEntry = {
  user: Pick<MemberSummary, "is_active" | "deleted_at">;
  profile: Pick<MemberProfile, "availability">;
};

function createEmptyHourlyCounts() {
  return Array.from({ length: 24 }, () => 0);
}

export function parseAvailabilityRanges(availability: MemberAvailability | null): Map<number, AvailabilityMinuteRange[]> {
  const rangesByDay = new Map<number, AvailabilityMinuteRange[]>();
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    rangesByDay.set(dayIndex, []);
  }

  if (availability === null) return rangesByDay;
  for (const window of availabilityToWindows(availability)) {
    rangesByDay.get(window.weekday)!.push({
      startMinutes: window.startMinute,
      endMinutes: window.endMinute,
    });
  }

  return rangesByDay;
}

/**
 * 一周里被时段覆盖的总分钟数。
 *
 * 资料页有两处要这个数——右栏的「一周 N 小时」和概览条上的每周在线。两处必须
 * 报同一个值，所以求和只写在这里；各算各的迟早会因为跨夜时段的处理不同而分叉。
 */
export function weeklyAvailableMinutes(availability: MemberAvailability | null): number {
  let total = 0;
  for (const ranges of parseAvailabilityRanges(availability).values()) {
    for (const range of ranges) {
      total += range.endMinutes - range.startMinutes;
    }
  }
  return total;
}

export function buildAvailabilityHeatData(users: AvailabilityMemberEntry[]): AvailabilityHeatData {
  const hourlyByDay = new Map<number, number[]>();
  const dayPeakByDay = new Map<number, number>();
  const daysWithAny = new Set<number>();
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    hourlyByDay.set(dayIndex, createEmptyHourlyCounts());
    dayPeakByDay.set(dayIndex, 0);
  }

  let memberCount = 0;
  for (const entry of users) {
    if (!entry.user.is_active || entry.user.deleted_at !== null) {
      continue;
    }
    const rangesByDay = parseAvailabilityRanges(entry.profile.availability);
    const hasAnyAvailability = Array.from(rangesByDay.values()).some((ranges) => ranges.length > 0);
    if (!hasAnyAvailability) {
      continue;
    }
    memberCount += 1;

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const ranges = rangesByDay.get(dayIndex) ?? [];
      if (ranges.length === 0) {
        continue;
      }
      const hourlyCounts = hourlyByDay.get(dayIndex) ?? createEmptyHourlyCounts();
      for (const range of ranges) {
        for (let hour = 0; hour < 24; hour += 1) {
          const hourStart = hour * 60;
          const hourEnd = hourStart + 60;
          if (range.startMinutes < hourEnd && hourStart < range.endMinutes) {
            hourlyCounts[hour] = (hourlyCounts[hour] ?? 0) + 1;
          }
        }
      }
      hourlyByDay.set(dayIndex, hourlyCounts);
    }
  }

  let maxCount = 0;
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const counts = hourlyByDay.get(dayIndex) ?? [];
    const peak = counts.reduce((currentMax, value) => Math.max(currentMax, value), 0);
    dayPeakByDay.set(dayIndex, peak);
    if (peak > 0) {
      daysWithAny.add(dayIndex);
    }
    maxCount = Math.max(maxCount, peak);
  }

  return {
    hourlyByDay,
    dayPeakByDay,
    daysWithAny,
    maxCount,
    memberCount,
  };
}
