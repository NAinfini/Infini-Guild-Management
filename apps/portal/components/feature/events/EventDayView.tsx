import type { Event } from "@guild/shared";
import { Badge, Button, Grid, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { format } from "date-fns";
import type { CSSProperties } from "react";
import { AvailabilityHeatStrip } from "./AvailabilityHeatStrip";
import { EventVirtualList } from "./EventVirtualList";

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

type EventDayViewProps = {
  selectedDateStart: Date;
  dayEvents: Event[];
  selectedDayOverlayStyle?: CSSProperties;
  showAvailabilityOverlay: boolean;
  selectedDayCounts: number[];
  availabilityMaxCount: number;
  emptyText: string;
  onSelectDate: (dateKey: string) => void;
};

export function EventDayView({
  selectedDateStart,
  dayEvents,
  selectedDayOverlayStyle,
  showAvailabilityOverlay,
  selectedDayCounts,
  availabilityMaxCount,
  emptyText,
  onSelectDate,
}: EventDayViewProps) {
  return (
    <Grid gutter={12}>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <div style={selectedDayOverlayStyle}>
        <InfiniCard>
          <Stack gap={8}>
            <Text fw={600}>Day Sidebar</Text>
          {showAvailabilityOverlay ? (
            <div style={{ marginBottom: 8 }}>
              <AvailabilityHeatStrip counts={selectedDayCounts} maxCount={availabilityMaxCount} />
            </div>
          ) : null}
          <EventVirtualList
            events={dayEvents}
            emptyText={emptyText}
            maxHeight={520}
            renderItem={(event) => (
              <Button
                key={event.id}
                fullWidth
                variant="subtle"
                style={{ justifyContent: "space-between", paddingInline: 0 }}
                onClick={() => onSelectDate(event.start_at.slice(0, 10))}
              >
                <span>{event.title}</span>
                <span>{format(new Date(event.start_at), "HH:mm")}</span>
              </Button>
            )}
          />
          </Stack>
        </InfiniCard>
        </div>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <div style={selectedDayOverlayStyle}>
        <InfiniCard>
          <Stack gap={8}>
            <Text fw={600}>{format(selectedDateStart, "yyyy-MM-dd")}</Text>
          {showAvailabilityOverlay ? (
            <div style={{ marginBottom: 8 }}>
              <AvailabilityHeatStrip counts={selectedDayCounts} maxCount={availabilityMaxCount} />
            </div>
          ) : null}
          <EventVirtualList
            events={dayEvents}
            emptyText={emptyText}
            maxHeight={520}
            renderItem={(event) => (
              <InfiniCard key={event.id}>
                <div style={{ padding: "1.2rem" }}>
                <Stack gap={4}>
                  <Text fw={600}>{event.title}</Text>
                  <Badge variant="light" size="sm" style={{ alignSelf: "flex-start" }}>{event.type}</Badge>
                  <Text size="sm">
                    {format(new Date(event.start_at), "HH:mm")}
                    {event.end_at ? ` - ${format(new Date(event.end_at), "HH:mm")}` : ""}
                  </Text>
                  <Text c="dimmed" size="sm">{event.description ?? "-"}</Text>
                  {event.attachments.length > 0 ? (
                    <Stack gap={4} style={{ width: "100%" }}>
                      <Text c="dimmed" size="sm">Attachments ({event.attachments.length})</Text>
                      {event.attachments.slice(0, 5).map((attachment) =>
                        isHttpUrl(attachment) ? (
                          <img
                            key={attachment}
                            src={attachment}
                            alt="Event attachment"
                            loading="lazy"
                            decoding="async"
                            style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8 }}
                          />
                        ) : (
                          <Text key={attachment} c="dimmed" size="sm" style={{ wordBreak: "break-all" }}>
                            {attachment}
                          </Text>
                        ),
                      )}
                    </Stack>
                  ) : null}
                </Stack>
                </div>
              </InfiniCard>
            )}
          />
          </Stack>
        </InfiniCard>
        </div>
      </Grid.Col>
    </Grid>
  );
}

