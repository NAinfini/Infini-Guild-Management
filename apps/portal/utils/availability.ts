import type { MemberProfile, User } from "@guild/shared";

type AvailabilityMinuteRange = {
  startMinutes: number;
  endMinutes: number;
};

export type AvailabilityHeatData = {
  hourlyByDay: Map<number, number[]>;
  dayPeakByDay: Map<number, number>;
  daysWithAny: Set<number>;
  maxCount: number;
  memberCount: number;
};

type AvailabilityMemberEntry = {
  user: Pick<User, "is_active" | "deleted_at">;
  profile: Pick<MemberProfile, "availability">;
};

const MODERN_AVAILABILITY_DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function createEmptyHourlyCounts() {
  return Array.from({ length: 24 }, () => 0);
}

function parseUtcMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1] ?? "", 10);
  const minutes = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function pushAvailabilityRange(
  rangesByDay: Map<number, AvailabilityMinuteRange[]>,
  dayIndex: number,
  startMinutes: number,
  endMinutes: number,
) {
  if (startMinutes === endMinutes) {
    return;
  }

  const current = rangesByDay.get(dayIndex) ?? [];
  const nextDayIndex = (dayIndex + 1) % 7;
  const nextDay = rangesByDay.get(nextDayIndex) ?? [];

  if (startMinutes < endMinutes) {
    current.push({ startMinutes, endMinutes });
    rangesByDay.set(dayIndex, current);
    return;
  }

  current.push({ startMinutes, endMinutes: 24 * 60 });
  nextDay.push({ startMinutes: 0, endMinutes });
  rangesByDay.set(dayIndex, current);
  rangesByDay.set(nextDayIndex, nextDay);
}

export function parseAvailabilityRanges(rawAvailability: unknown): Map<number, AvailabilityMinuteRange[]> {
  const rangesByDay = new Map<number, AvailabilityMinuteRange[]>();
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    rangesByDay.set(dayIndex, []);
  }

  if (!rawAvailability || typeof rawAvailability !== "object") {
    return rangesByDay;
  }

  const record = rawAvailability as Record<string, unknown>;
  const daysObject =
    record.days && typeof record.days === "object" && !Array.isArray(record.days)
      ? (record.days as Record<string, unknown>)
      : null;
  if (!daysObject) return rangesByDay;

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const modernKey = MODERN_AVAILABILITY_DAY_KEYS[dayIndex]!;
    const rowsCandidate = daysObject[modernKey];
    if (!Array.isArray(rowsCandidate)) {
      continue;
    }

    for (const row of rowsCandidate) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const item = row as Record<string, unknown>;
      const startMinutes = parseUtcMinutes(item.start_utc);
      const endMinutes = parseUtcMinutes(item.end_utc);
      if (startMinutes === null || endMinutes === null) {
        continue;
      }
      pushAvailabilityRange(rangesByDay, dayIndex, startMinutes, endMinutes);
    }
  }

  return rangesByDay;
}

/**
 * 一周里被时段覆盖的总分钟数。
 *
 * 资料页有两处要这个数——右栏的「一周 N 小时」和概览条上的每周在线。两处必须
 * 报同一个值，所以求和只写在这里；各算各的迟早会因为跨夜时段的处理不同而分叉。
 */
export function weeklyAvailableMinutes(rawAvailability: unknown): number {
  let total = 0;
  for (const ranges of parseAvailabilityRanges(rawAvailability).values()) {
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
