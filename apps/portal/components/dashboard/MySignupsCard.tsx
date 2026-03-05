import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserCheckOutlined } from "../../utils/icons";
import { cardHeading, eventTypeTagColor, formatDateTime, type DashboardMySignupEvent } from "./shared";

type MySignupsCardProps = {
  mySignupEvents: DashboardMySignupEvent[];
  now: Date;
  onOpenEvent: (eventId: string) => void;
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function MySignupsCard({ mySignupEvents, now, onOpenEvent }: MySignupsCardProps) {
  const { t, i18n } = useTranslation("dashboard");

  const days = useMemo(() => {
    const result: { date: Date; label: string; dayLabel: string; events: DashboardMySignupEvent[] }[] = [];
    for (let offset = -1; offset <= 7; offset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);

      const dayLabel = date.toLocaleString(i18n.language, { weekday: "short" }).toUpperCase();
      const label = `${date.getDate()}`;

      const dayEvents = mySignupEvents.filter((item) => {
        const startAt = new Date(item.event.start_at);
        return isSameDay(startAt, date);
      });

      result.push({ date, label, dayLabel, events: dayEvents });
    }
    return result;
  }, [mySignupEvents, now]);

  const isToday = (date: Date) => isSameDay(date, now);

  return (
    <InfiniCard className="dashboard-card" interactive={false} overrides={{ glow: { variant: "spotlight", glowIntensity: 0.2 } }}>
      {cardHeading(t("card.mySignups.title"), <UserCheckOutlined size={18} />)}
      <Group gap={4} mt={12} wrap="nowrap" style={{ width: "100%" }}>
        {days.map((day) => {
          const today = isToday(day.date);
          const hasEvents = day.events.length > 0;

          const tooltipContent = hasEvents ? (
            <Stack gap={4}>
              {day.events.map((item) => (
                <Stack key={item.event.id} gap={2}>
                  <Text size="xs" fw={600}>{item.event.title}</Text>
                  <Group gap={4}>
                    <Badge size="xs" color={eventTypeTagColor(item.event.type)} variant="light">
                      {t(`common:eventType.${item.event.type}`)}
                    </Badge>
                    <Text size="xs">{formatDateTime(item.event.start_at)}</Text>
                  </Group>
                  {item.event.description ? (
                    <Text size="xs" c="dimmed" lineClamp={2}>{item.event.description}</Text>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          ) : null;

          const box = (
            <div
              key={day.date.toISOString()}
              onClick={hasEvents && day.events.length === 1 ? () => onOpenEvent(day.events[0].event.id) : undefined}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                padding: "6px 2px",
                borderRadius: "8px",
                cursor: hasEvents && day.events.length === 1 ? "pointer" : "default",
                background: today
                  ? "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 12%, transparent)"
                  : "color-mix(in srgb, var(--infini-color-surface, #fff) 95%, var(--infini-color-text, #111827))",
                border: today
                  ? "1px solid color-mix(in srgb, var(--infini-color-primary, #3b82f6) 30%, transparent)"
                  : "1px solid transparent",
              }}
            >
              <Text size="10px" c="dimmed" fw={600}>{day.dayLabel}</Text>
              <Text size="sm" fw={today ? 700 : 500}>{day.label}</Text>
              <Stack gap={2} align="center" style={{ minHeight: 20 }}>
                {day.events.map((item) => (
                  <div
                    key={item.event.id}
                    style={{
                      width: "100%",
                      height: 4,
                      borderRadius: 2,
                      background: `var(--mantine-color-${eventTypeTagColor(item.event.type)}-5, var(--infini-color-primary, #3b82f6))`,
                    }}
                  />
                ))}
              </Stack>
            </div>
          );

          return hasEvents ? (
            <Tooltip
              key={day.date.toISOString()}
              label={tooltipContent}
              withArrow
              multiline
              w={220}
            >
              {box}
            </Tooltip>
          ) : (
            <div key={day.date.toISOString()} style={{ flex: 1, minWidth: 0 }}>
              {box}
            </div>
          );
        })}
      </Group>
    </InfiniCard>
  );
}
