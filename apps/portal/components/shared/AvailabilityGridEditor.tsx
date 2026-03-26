import { forwardRef } from "react";
import { Badge, Button, Card, Group, Stack, Text, TextInput } from "@mantine/core";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

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

export type AvailabilityGridLabels = {
  timezoneNote: string;
  clearAll: string;
  gridHint: string;
  vacation: string;
  startDate: string;
  endDate: string;
  dayMon: string;
  dayTue: string;
  dayWed: string;
  dayThu: string;
  dayFri: string;
  daySat: string;
  daySun: string;
};

const DEFAULT_LABELS: AvailabilityGridLabels = {
  timezoneNote: "Times shown in your local timezone",
  clearAll: "Clear all",
  gridHint: "Click and drag to select available time slots",
  vacation: "Vacation",
  startDate: "Start date",
  endDate: "End date",
  dayMon: "Mon",
  dayTue: "Tue",
  dayWed: "Wed",
  dayThu: "Thu",
  dayFri: "Fri",
  daySat: "Sat",
  daySun: "Sun",
};

type AvailabilityGridEditorProps = {
  value: Record<string, unknown> | null;
  vacationStart: string;
  vacationEnd: string;
  onChange: (next: {
    availability: AvailabilityPayload;
    vacationStart: string;
    vacationEnd: string;
  }) => void;
  labels?: Partial<AvailabilityGridLabels>;
  className?: string;
  style?: CSSProperties;
};

const DAYS: Array<{ key: DayKey; shortLabel: string }> = [
  { key: "monday", shortLabel: "Mon" },
  { key: "tuesday", shortLabel: "Tue" },
  { key: "wednesday", shortLabel: "Wed" },
  { key: "thursday", shortLabel: "Thu" },
  { key: "friday", shortLabel: "Fri" },
  { key: "saturday", shortLabel: "Sat" },
  { key: "sunday", shortLabel: "Sun" },
];

const SLOTS = 48;
const SLOT_MINUTES = 30;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function slotToTime(slot: number): string {
  const hour = Math.floor((slot * SLOT_MINUTES) / 60);
  const minute = (slot * SLOT_MINUTES) % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function timeToSlot(time: string): number {
  const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
  return Math.floor(((h || 0) * 60 + (m || 0)) / SLOT_MINUTES);
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

type GridState = Record<DayKey, boolean[]>;

function emptyGrid(): GridState {
  const grid = {} as GridState;
  for (const day of DAYS) {
    grid[day.key] = Array.from({ length: SLOTS }, () => false);
  }
  return grid;
}

function parseValue(value: Record<string, unknown> | null): GridState {
  const grid = emptyGrid();
  if (!value || typeof value !== "object") return grid;
  const days = value.days;
  if (!days || typeof days !== "object") return grid;

  for (const day of DAYS) {
    const list = (days as Record<string, unknown>)[day.key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const startUtc = typeof row.start_utc === "string" ? row.start_utc : null;
      const endUtc = typeof row.end_utc === "string" ? row.end_utc : null;
      if (!startUtc || !endUtc) continue;
      const localStart = utcTimeToLocal(startUtc);
      const localEnd = utcTimeToLocal(endUtc);
      const startSlot = timeToSlot(localStart);
      const endSlot = timeToSlot(localEnd);
      for (let s = startSlot; s < endSlot && s < SLOTS; s++) {
        grid[day.key][s] = true;
      }
    }
  }
  return grid;
}

function gridToBlocks(grid: GridState): Record<DayKey, TimeBlock[]> {
  const result = {} as Record<DayKey, TimeBlock[]>;
  for (const day of DAYS) {
    const blocks: TimeBlock[] = [];
    let blockStart: number | null = null;
    for (let s = 0; s <= SLOTS; s++) {
      const active = s < SLOTS && grid[day.key][s];
      if (active && blockStart === null) {
        blockStart = s;
      } else if (!active && blockStart !== null) {
        blocks.push({ start: slotToTime(blockStart), end: slotToTime(s) });
        blockStart = null;
      }
    }
    result[day.key] = blocks;
  }
  return result;
}

function toPayload(grid: GridState): AvailabilityPayload {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const blocks = gridToBlocks(grid);
  const days = {} as Record<DayKey, Array<{ start_utc: string; end_utc: string }>>;
  for (const day of DAYS) {
    days[day.key] = blocks[day.key].map((b) => ({
      start_utc: localTimeToUtc(b.start),
      end_utc: localTimeToUtc(b.end),
    }));
  }
  return { timezone, days };
}

const HOUR_LABELS: Array<{ slot: number; label: string }> = [];
for (let h = 0; h < 24; h++) {
  HOUR_LABELS.push({ slot: h * 2, label: `${pad2(h)}:00` });
}

export const AvailabilityGridEditor = forwardRef<HTMLDivElement, AvailabilityGridEditorProps>(
  function AvailabilityGridEditor({
    value,
    vacationStart,
    vacationEnd,
    onChange,
    labels: labelsProp,
    className,
    style,
    ...rest
  }, ref) {
    const labels = { ...DEFAULT_LABELS, ...labelsProp };
    const [grid, setGrid] = useState<GridState>(() => parseValue(value));
    const gridRef = useRef<GridState>(grid);
    const [vacationStartValue, setVacationStartValue] = useState(vacationStart);
    const [vacationEndValue, setVacationEndValue] = useState(vacationEnd);
    const [isDragging, setIsDragging] = useState(false);
    const paintModeRef = useRef<boolean>(true);
    const lastCellRef = useRef<string | null>(null);

    useEffect(() => {
      const parsed = parseValue(value);
      gridRef.current = parsed;
      setGrid(parsed);
    }, [value]);

    useEffect(() => {
      gridRef.current = grid;
    }, [grid]);

    useEffect(() => {
      setVacationStartValue(vacationStart);
    }, [vacationStart]);

    useEffect(() => {
      setVacationEndValue(vacationEnd);
    }, [vacationEnd]);

    const emit = useCallback(
      (
        nextGrid: GridState,
        nextVacationStart = vacationStartValue,
        nextVacationEnd = vacationEndValue,
      ) => {
        onChange({
          availability: toPayload(nextGrid),
          vacationStart: nextVacationStart,
          vacationEnd: nextVacationEnd,
        });
      },
      [onChange, vacationStartValue, vacationEndValue],
    );

    const toggleCell = useCallback(
      (dayKey: DayKey, slot: number, paint: boolean) => {
        setGrid((prev) => {
          const next = { ...prev, [dayKey]: [...prev[dayKey]] };
          next[dayKey][slot] = paint;
          gridRef.current = next;
          return next;
        });
      },
      [],
    );

    const handlePointerDown = useCallback(
      (dayKey: DayKey, slot: number) => {
        const paint = !grid[dayKey][slot];
        paintModeRef.current = paint;
        lastCellRef.current = `${dayKey}-${slot}`;
        setIsDragging(true);
        toggleCell(dayKey, slot, paint);
      },
      [grid, toggleCell],
    );

    const handlePointerEnter = useCallback(
      (dayKey: DayKey, slot: number) => {
        if (!isDragging) return;
        const cellKey = `${dayKey}-${slot}`;
        if (lastCellRef.current === cellKey) return;
        lastCellRef.current = cellKey;
        toggleCell(dayKey, slot, paintModeRef.current);
      },
      [isDragging, toggleCell],
    );

    const handlePointerUp = useCallback(() => {
      if (!isDragging) return;
      setIsDragging(false);
      lastCellRef.current = null;
      emit(gridRef.current);
    }, [isDragging, emit]);

    useEffect(() => {
      if (!isDragging) return;
      const up = () => {
        setIsDragging(false);
        lastCellRef.current = null;
        emit(gridRef.current);
      };
      window.addEventListener("pointerup", up);
      return () => window.removeEventListener("pointerup", up);
    }, [isDragging, emit]);

    const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

    const clearAll = () => {
      const next = emptyGrid();
      setGrid(next);
      emit(next);
    };

    return (
      <Stack ref={ref} gap={12} w="100%" className={className} style={style} {...rest}>
        <Group gap={8} justify="space-between" wrap="wrap">
          <Group gap={8}>
            <Text c="dimmed" size="sm">{labels.timezoneNote}</Text>
            <Badge variant="light">{timezone}</Badge>
          </Group>
          <Button size="compact-xs" variant="light" color="infini-danger" onClick={clearAll}>
            {labels.clearAll}
          </Button>
        </Group>

        <div
          className="availability-grid-wrapper"
          style={{
            overflowX: "auto",
            userSelect: "none",
            WebkitUserSelect: "none",
            touchAction: "none",
          }}
        >
          <table
            className="availability-grid"
            style={{
              borderCollapse: "collapse",
              width: "100%",
              minWidth: 420,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    width: 52,
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: "var(--mantine-color-body)",
                  }}
                />
                {DAYS.map((day) => (
                  <th
                    key={day.key}
                    style={{
                      textAlign: "center",
                      padding: "6px 2px",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {day.key === "monday"
                      ? labels.dayMon
                      : day.key === "tuesday"
                        ? labels.dayTue
                        : day.key === "wednesday"
                          ? labels.dayWed
                          : day.key === "thursday"
                            ? labels.dayThu
                            : day.key === "friday"
                              ? labels.dayFri
                              : day.key === "saturday"
                                ? labels.daySat
                                : labels.daySun}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOUR_LABELS.map(({ slot: hourSlot, label }, hourIndex) => (
                <Fragment key={`hour-${hourSlot}`}>
                  <tr key={`h-${hourSlot}`}>
                    <td
                      rowSpan={2}
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--mantine-color-dimmed)",
                        textAlign: "right",
                        paddingRight: 6,
                        verticalAlign: "top",
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        background: "var(--mantine-color-body)",
                        lineHeight: 1,
                        paddingTop: 2,
                      }}
                    >
                      {hourIndex % 2 === 0 ? label : ""}
                    </td>
                    {DAYS.map((day) => (
                      <td
                        key={`${day.key}-${hourSlot}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          handlePointerDown(day.key, hourSlot);
                        }}
                        onPointerEnter={() => handlePointerEnter(day.key, hourSlot)}
                        onPointerUp={handlePointerUp}
                        style={{
                          width: `${100 / 7}%`,
                          height: 14,
                          background: grid[day.key][hourSlot]
                            ? "var(--mantine-primary-color-filled, var(--infini-color-primary, #3b82f6))"
                            : "transparent",
                          borderTop: "1px solid var(--mantine-color-default-border)",
                          borderLeft: "1px solid var(--mantine-color-default-border)",
                          borderRight: "1px solid var(--mantine-color-default-border)",
                          cursor: "pointer",
                          transition: "background 0.05s",
                        }}
                      />
                    ))}
                  </tr>
                  <tr key={`hh-${hourSlot + 1}`}>
                    {DAYS.map((day) => (
                      <td
                        key={`${day.key}-${hourSlot + 1}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          handlePointerDown(day.key, hourSlot + 1);
                        }}
                        onPointerEnter={() => handlePointerEnter(day.key, hourSlot + 1)}
                        onPointerUp={handlePointerUp}
                        style={{
                          height: 14,
                          background: grid[day.key][hourSlot + 1]
                            ? "var(--mantine-primary-color-filled, var(--infini-color-primary, #3b82f6))"
                            : "transparent",
                          borderLeft: "1px solid var(--mantine-color-default-border)",
                          borderRight: "1px solid var(--mantine-color-default-border)",
                          borderBottom:
                            hourIndex === HOUR_LABELS.length - 1
                              ? "1px solid var(--mantine-color-default-border)"
                              : "none",
                          cursor: "pointer",
                          transition: "background 0.05s",
                        }}
                      />
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <Text c="dimmed" size="xs" ta="center">
          {labels.gridHint}
        </Text>

        <Card withBorder padding="sm">
          <Text fw={600} mb={8}>{labels.vacation}</Text>
          <Group wrap="wrap" align="flex-start">
            <Stack gap={4}>
              <Text c="dimmed" size="sm">{labels.startDate}</Text>
              <TextInput
                type="date"
                value={vacationStartValue}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setVacationStartValue(nextValue);
                  emit(grid, nextValue, vacationEndValue);
                }}
              />
            </Stack>
            <Stack gap={4}>
              <Text c="dimmed" size="sm">{labels.endDate}</Text>
              <TextInput
                type="date"
                value={vacationEndValue}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setVacationEndValue(nextValue);
                  emit(grid, vacationStartValue, nextValue);
                }}
              />
            </Stack>
          </Group>
        </Card>
      </Stack>
    );
  }
);
