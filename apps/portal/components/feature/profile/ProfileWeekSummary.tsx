import { Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parseAvailabilityRanges } from "../../../utils/availability";

type ProfileWeekSummaryProps = {
  availabilityData: Record<string, unknown> | null;
};

const DAY_LABEL_KEYS = [
  "availability.editor.daySun",
  "availability.editor.dayMon",
  "availability.editor.dayTue",
  "availability.editor.dayWed",
  "availability.editor.dayThu",
  "availability.editor.dayFri",
  "availability.editor.daySat",
] as const;

/*
 * 两小时一格。一天 24 格在 300px 的预览栏里每格不到 8px，看不出块状；
 * 12 格既放得下整天，又能让「晚上八点到十一点」连成一条可辨认的带子。
 */
const HOURS_PER_CELL = 2;
const CELLS_PER_DAY = 24 / HOURS_PER_CELL;
/* 只标偶数刻度：每格都标数字会比格子本身还挤。 */
const HOUR_TICKS = [0, 6, 12, 18];

/**
 * 时间屏的预览：把 7×24 的编辑网格压成一眼能看完的一周。
 *
 * 编辑器只告诉你哪些格子被涂了，从不给总量，也从不说这些时段就是名册上那颗
 * 在线点的依据。这里给的是「别人什么时候找得到你」——总时数、最长的一天，
 * 以及一张和编辑网格同构、但缩到预览栏宽度的热力图。
 */
export function ProfileWeekSummary({ availabilityData }: ProfileWeekSummaryProps) {
  const { t } = useTranslation("profile");

  const summary = useMemo(() => {
    const rangesByDay = parseAvailabilityRanges(availabilityData);
    const perDay = Array.from({ length: 7 }, (_, dayIndex) => {
      const ranges = rangesByDay.get(dayIndex) ?? [];
      const minutes = ranges.reduce(
        (total, range) => total + (range.endMinutes - range.startMinutes),
        0,
      );
      /*
       * 每格记它被覆盖的分钟数，而不是「有没有被覆盖」：半格也上色的话，
       * 一次 30 分钟的零星勾选会和整整两小时看起来一样重。
       */
      const cells = Array.from({ length: CELLS_PER_DAY }, (_, cellIndex) => {
        const cellStart = cellIndex * HOURS_PER_CELL * 60;
        const cellEnd = cellStart + HOURS_PER_CELL * 60;
        let covered = 0;
        for (const range of ranges) {
          const overlap = Math.min(range.endMinutes, cellEnd) - Math.max(range.startMinutes, cellStart);
          if (overlap > 0) covered += overlap;
        }
        return covered / (HOURS_PER_CELL * 60);
      });
      return { dayIndex, minutes, cells };
    });
    const totalMinutes = perDay.reduce((total, day) => total + day.minutes, 0);
    const peak = perDay.reduce(
      (best, day) => (day.minutes > best.minutes ? day : best),
      { dayIndex: 0, minutes: 0 },
    );
    return { perDay, totalMinutes, peak };
  }, [availabilityData]);

  return (
    <section className="profile-week">
      <Text size="xs" fw={600} c="dimmed" className="profile-rail__label">
        {t("week.railLabel")}
      </Text>

      <div className="profile-week__total">
        <Text fw={700} size="xl" lh={1.1}>
          {t("week.hours", { hours: Math.round(summary.totalMinutes / 60) })}
        </Text>
        <Text size="xs" c="dimmed">
          {summary.peak.minutes > 0
            ? t("week.peakDay", { day: t(DAY_LABEL_KEYS[summary.peak.dayIndex]!) })
            : t("week.emptyWarning")}
        </Text>
      </div>

      <div className="profile-week__map">
        <div className="profile-week__ticks" aria-hidden="true">
          {HOUR_TICKS.map((hour) => (
            <span
              key={hour}
              className="profile-week__tick"
              /* +2：第一列留给星期名，刻度从第二列起算。 */
              style={{ gridColumnStart: hour / HOURS_PER_CELL + 2 }}
            >
              {hour}
            </span>
          ))}
        </div>
        {summary.perDay.map((day) => (
          <div key={day.dayIndex} className="profile-week__day-row">
            <span className="profile-week__day">{t(DAY_LABEL_KEYS[day.dayIndex]!)}</span>
            <div className="profile-week__cells">
              {day.cells.map((coverage, cellIndex) => (
                <span
                  key={cellIndex}
                  className="profile-week__cell"
                  /* 覆盖率驱动透明度，所以半格看起来就是半格。 */
                  style={coverage > 0 ? { opacity: 0.35 + coverage * 0.65 } : undefined}
                  data-on={coverage > 0 ? "" : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
