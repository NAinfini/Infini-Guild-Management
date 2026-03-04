import { Badge, Button, Card, Group, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";

type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type TimeBlock = {
  start: string;
  end: string;
};

type AvailabilityPayload = {
  timezone: string;
  days: Record<DayKey, Array<{ start_utc: string; end_utc: string }>>;
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
};

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localTimeToUtc(localTime: string): string {
  const [hours, minutes] = localTime.split(":").map((value) => Number.parseInt(value, 10));
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function utcTimeToLocal(utcTime: string): string {
  const [hours, minutes] = utcTime.split(":").map((value) => Number.parseInt(value, 10));
  const date = new Date();
  date.setUTCHours(hours || 0, minutes || 0, 0, 0);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseValue(value: Record<string, unknown> | null): Record<DayKey, TimeBlock[]> {
  const fallback: Record<DayKey, TimeBlock[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const days = value.days;
  if (!days || typeof days !== "object") {
    return fallback;
  }

  for (const day of DAYS) {
    const list = (days as Record<string, unknown>)[day.key];
    if (!Array.isArray(list)) {
      continue;
    }
    fallback[day.key] = list.flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const row = item as Record<string, unknown>;
      const startUtc = typeof row.start_utc === "string" ? row.start_utc : null;
      const endUtc = typeof row.end_utc === "string" ? row.end_utc : null;
      if (!startUtc || !endUtc) {
        return [];
      }
      return [
        {
          start: utcTimeToLocal(startUtc),
          end: utcTimeToLocal(endUtc),
        },
      ];
    });
  }

  return fallback;
}

function mergeOverlapping(blocks: TimeBlock[]): TimeBlock[] {
  const normalized = blocks
    .filter((block) => block.start < block.end)
    .map((block) => ({
      ...block,
      startMinutes:
        Number.parseInt(block.start.slice(0, 2), 10) * 60 +
        Number.parseInt(block.start.slice(3, 5), 10),
      endMinutes:
        Number.parseInt(block.end.slice(0, 2), 10) * 60 + Number.parseInt(block.end.slice(3, 5), 10),
    }))
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const merged: Array<{ startMinutes: number; endMinutes: number }> = [];
  for (const block of normalized) {
    const last = merged[merged.length - 1];
    if (!last || block.startMinutes > last.endMinutes) {
      merged.push({ startMinutes: block.startMinutes, endMinutes: block.endMinutes });
      continue;
    }
    last.endMinutes = Math.max(last.endMinutes, block.endMinutes);
  }

  return merged.map((block) => ({
    start: `${pad2(Math.floor(block.startMinutes / 60))}:${pad2(block.startMinutes % 60)}`,
    end: `${pad2(Math.floor(block.endMinutes / 60))}:${pad2(block.endMinutes % 60)}`,
  }));
}

function toAvailabilityPayload(blocksByDay: Record<DayKey, TimeBlock[]>): AvailabilityPayload {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = DAYS.reduce((accumulator, day) => {
    accumulator[day.key] = mergeOverlapping(blocksByDay[day.key]).map((block) => ({
      start_utc: localTimeToUtc(block.start),
      end_utc: localTimeToUtc(block.end),
    }));
    return accumulator;
  }, {} as Record<DayKey, Array<{ start_utc: string; end_utc: string }>>);

  return { timezone, days };
}

export function AvailabilityGridEditor({
  value,
  vacationStart,
  vacationEnd,
  onChange,
}: AvailabilityGridEditorProps) {
  const [blocksByDay, setBlocksByDay] = useState<Record<DayKey, TimeBlock[]>>(() => parseValue(value));
  const [vacationStartValue, setVacationStartValue] = useState(vacationStart);
  const [vacationEndValue, setVacationEndValue] = useState(vacationEnd);

  useEffect(() => {
    setBlocksByDay(parseValue(value));
  }, [value]);

  useEffect(() => {
    setVacationStartValue(vacationStart);
  }, [vacationStart]);

  useEffect(() => {
    setVacationEndValue(vacationEnd);
  }, [vacationEnd]);

  const emit = (
    nextBlocks: Record<DayKey, TimeBlock[]>,
    nextVacationStart = vacationStartValue,
    nextVacationEnd = vacationEndValue,
  ) => {
    onChange({
      availability: toAvailabilityPayload(nextBlocks),
      vacationStart: nextVacationStart,
      vacationEnd: nextVacationEnd,
    });
  };

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  return (
    <Stack gap={12} w="100%">
      <Group gap={8} wrap="wrap">
        <Text c="dimmed" size="sm">
          Times are stored in UTC. You are editing in local timezone:
        </Text>
        <Badge variant="light">{timezone}</Badge>
      </Group>

      {DAYS.map((day) => (
        <Card key={day.key} withBorder padding="sm">
          <Group justify="space-between" align="center" mb={10} wrap="wrap">
            <Text fw={600}>{day.label}</Text>
            <Group gap={8}>
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  const next = {
                    ...blocksByDay,
                    [day.key]: [...blocksByDay[day.key], { start: "09:00", end: "11:00" }],
                  };
                  setBlocksByDay(next);
                  emit(next);
                }}
              >
                Add Block
              </Button>
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={() => {
                  const next = { ...blocksByDay, [day.key]: [] };
                  setBlocksByDay(next);
                  emit(next);
                }}
              >
                Clear Day
              </Button>
            </Group>
          </Group>

          <Stack gap={8}>
            {blocksByDay[day.key].length === 0 ? <Text c="dimmed" size="sm">No availability blocks</Text> : null}
            {blocksByDay[day.key].map((block, index) => (
              <Group key={`${day.key}-${index}`} wrap="wrap" align="center">
                <TextInput
                  type="time"
                  value={block.start}
                  onChange={(event) => {
                    const next = {
                      ...blocksByDay,
                      [day.key]: blocksByDay[day.key].map((item, itemIndex) =>
                        itemIndex === index ? { ...item, start: event.currentTarget.value } : item,
                      ),
                    };
                    next[day.key] = mergeOverlapping(next[day.key]);
                    setBlocksByDay(next);
                    emit(next);
                  }}
                  style={{ width: 130 }}
                />
                <Text size="sm">to</Text>
                <TextInput
                  type="time"
                  value={block.end}
                  onChange={(event) => {
                    const next = {
                      ...blocksByDay,
                      [day.key]: blocksByDay[day.key].map((item, itemIndex) =>
                        itemIndex === index ? { ...item, end: event.currentTarget.value } : item,
                      ),
                    };
                    next[day.key] = mergeOverlapping(next[day.key]);
                    setBlocksByDay(next);
                    emit(next);
                  }}
                  style={{ width: 130 }}
                />
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  onClick={() => {
                    const next = {
                      ...blocksByDay,
                      [day.key]: blocksByDay[day.key].filter((_, itemIndex) => itemIndex !== index),
                    };
                    setBlocksByDay(next);
                    emit(next);
                  }}
                >
                  Delete
                </Button>
              </Group>
            ))}
          </Stack>
        </Card>
      ))}

      <Card withBorder padding="sm">
        <Text fw={600} mb={8}>
          Vacation
        </Text>
        <Group wrap="wrap" align="flex-start">
          <Stack gap={4}>
            <Text c="dimmed" size="sm">
              Start date
            </Text>
            <TextInput
              type="date"
              value={vacationStartValue}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                setVacationStartValue(nextValue);
                emit(blocksByDay, nextValue, vacationEndValue);
              }}
            />
          </Stack>
          <Stack gap={4}>
            <Text c="dimmed" size="sm">
              End date
            </Text>
            <TextInput
              type="date"
              value={vacationEndValue}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                setVacationEndValue(nextValue);
                emit(blocksByDay, vacationStartValue, nextValue);
              }}
            />
          </Stack>
        </Group>
      </Card>
    </Stack>
  );
}
