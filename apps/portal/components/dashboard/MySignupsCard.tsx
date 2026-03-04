import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Badge, Group, RingProgress, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { UserCheckOutlined } from "../../utils/icons";
import { EmptyState } from "../shared/EmptyState";
import { cardHeading, formatDateTime, type DashboardMySignupEvent } from "./shared";

type MySignupsCardProps = {
  mySignupEvents: DashboardMySignupEvent[];
  now: Date;
  onOpenEvent: (eventId: string) => void;
};

export function MySignupsCard({ mySignupEvents, now, onOpenEvent }: MySignupsCardProps) {
  const { t } = useTranslation("dashboard");

  return (
    <InfiniCard className="dashboard-card" overrides={{ glow: { variant: "spotlight", glowIntensity: 0.2 } }}>
      {cardHeading(t("card.mySignups.title"), <UserCheckOutlined size={18} />)}
      {mySignupEvents.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <Stack gap={8} mt={12}>
          {mySignupEvents.slice(0, 5).map(({ event, participantCount }) => {
            const capacity = event.capacity ?? 0;
            const percentage = capacity > 0 ? Math.round((participantCount / capacity) * 100) : 100;

            return (
              <div
                key={event.id}
                onClick={() => onOpenEvent(event.id)}
                style={{
                  padding: "10px",
                  border: "1px solid color-mix(in srgb, var(--infini-color-text, #111827) 12%, transparent)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "border-color 150ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--infini-color-primary, #3b82f6) 35%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--infini-color-text, #111827) 12%, transparent)";
                }}
              >
                <Group gap={12} wrap="nowrap">
                  <RingProgress
                    size={50}
                    thickness={4}
                    sections={[{ value: percentage, color: "var(--infini-color-primary, #3b82f6)" }]}
                    label={
                      <Text size="xs" ta="center" fw={600}>
                        {capacity > 0 ? `${participantCount}/${capacity}` : "∞"}
                      </Text>
                    }
                  />
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} size="sm" truncate>{event.title}</Text>
                    <Text size="xs" c="dimmed">{formatDateTime(event.start_at)}</Text>
                    <Badge size="xs" color="green" variant="light">Joined</Badge>
                  </Stack>
                </Group>
              </div>
            );
          })}
        </Stack>
      )}
    </InfiniCard>
  );
}
