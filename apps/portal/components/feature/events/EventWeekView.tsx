import type { Event } from "@guild/shared";
import { Badge, Grid, Group, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { format } from "date-fns";
import { type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { AvailabilityHeatStrip } from "./AvailabilityHeatStrip";
import { EventVirtualList } from "./EventVirtualList";

function createEmptyHourlyCounts() {
  return Array.from({ length: 24 }, () => 0);
}

function buildAvailabilityOverlayStyle(intensity: number, maxCount: number): CSSProperties | undefined {
  if (!maxCount || intensity <= 0) {
    return undefined;
  }
  const ratio = Math.min(1, intensity / maxCount);
  const strength = Math.round(10 + ratio * 72);
  return {
    background: `color-mix(in srgb, var(--infini-color-success, #22c55e) ${strength}%, transparent)`,
  };
}

type EventWeekViewProps = {
  weekDates: Date[];
  weekEventsMap: Map<string, Event[]>;
  showAvailabilityOverlay: boolean;
  availabilityHourlyByDay: Map<number, number[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  canManage: boolean;
  emptyText: string;
  resizingPreviewEndById: Record<string, string>;
  onResizeMouseDown: (eventItem: Event, mouseDownEvent: ReactMouseEvent) => void;
  onResizeByKeyboard: (eventItem: Event) => void;
};

export function EventWeekView({
  weekDates,
  weekEventsMap,
  showAvailabilityOverlay,
  availabilityHourlyByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  canManage,
  emptyText,
  resizingPreviewEndById,
  onResizeMouseDown,
  onResizeByKeyboard,
}: EventWeekViewProps) {
  return (
    <Grid gutter={12}>
      {weekDates.map((date) => {
        const key = date.toISOString().slice(0, 10);
        const dayList = weekEventsMap.get(key) ?? [];
        const dayIndex = date.getDay();
        const overlayIntensity = showAvailabilityOverlay ? (availabilityDayPeakByDay.get(dayIndex) ?? 0) : 0;
        const overlayStyle = buildAvailabilityOverlayStyle(overlayIntensity, availabilityMaxCount);
        const hourlyCounts = availabilityHourlyByDay.get(dayIndex) ?? createEmptyHourlyCounts();
        return (
          <Grid.Col key={key} span={{ base: 12, md: 6, xl: 4 }}>
            <div style={overlayStyle}>
            <InfiniCard>
              <Group justify="space-between" mb={8}>
                <Text fw={600}>{format(date, "EEE yyyy-MM-dd")}</Text>
                <Badge variant="light">{dayList.length}</Badge>
              </Group>
              {showAvailabilityOverlay ? (
                <div style={{ marginBottom: 8 }}>
                  <AvailabilityHeatStrip counts={hourlyCounts} maxCount={availabilityMaxCount} />
                </div>
              ) : null}
              <EventVirtualList
                events={dayList}
                emptyText={emptyText}
                renderItem={(event) => (
                  <div key={event.id}>
                    <Text fw={600}>{event.title}</Text>
                    <br />
                    <Text c="dimmed" size="sm">{format(new Date(event.start_at), "HH:mm")}</Text>
                    <br />
                    <Text c="dimmed" size="sm">
                      {event.end_at ? format(new Date(event.end_at), "HH:mm") : format(new Date(event.start_at), "HH:mm")}
                    </Text>
                    {canManage ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onMouseDown={(eventMouseDown) => onResizeMouseDown(event, eventMouseDown)}
                        onKeyDown={(keyboardEvent) => {
                          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                            keyboardEvent.preventDefault();
                            onResizeByKeyboard(event);
                          }
                        }}
                        style={{
                          marginTop: 4,
                          height: 6,
                          borderRadius: 999,
                          background: "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 42%, transparent)",
                          cursor: "ns-resize",
                        }}
                        aria-label={`Resize ${event.title}`}
                      />
                    ) : null}
                    {resizingPreviewEndById[event.id] ? (
                      <Text c="dimmed" size="xs">
                        End preview: {format(new Date(resizingPreviewEndById[event.id] as string), "HH:mm")}
                      </Text>
                    ) : null}
                  </div>
                )}
              />
            </InfiniCard>
            </div>
          </Grid.Col>
        );
      })}
    </Grid>
  );
}

