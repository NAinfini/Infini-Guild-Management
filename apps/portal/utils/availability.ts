import { availabilityToWindows, type MemberAvailability, type MemberProfile, type User } from "@guild/shared";

export type AvailabilityMinuteRange = {
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
