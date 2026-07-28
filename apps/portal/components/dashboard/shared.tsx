import type { Event } from "@guild/shared";
import { EVENT_TYPE_COLORS, UNKNOWN_EVENT_TYPE_COLOR } from "@portal/utils/event-colors";
import { Group, Text } from "@mantine/core";
import { format } from "date-fns";
import type { ReactNode } from "react";

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return format(date, "yyyy-MM-dd HH:mm");
}

export function eventTypeTagColor(value: string): string {
  return EVENT_TYPE_COLORS[value] ?? UNKNOWN_EVENT_TYPE_COLOR;
}

export function cardHeading(text: string, icon?: ReactNode) {
  return (
    <Group gap={8} align="center" wrap="nowrap" className="dashboard-card-title">
      {icon ? <span className="dashboard-card-title-icon">{icon}</span> : null}
      <Text fw={700} style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
        {text}
      </Text>
    </Group>
  );
}

export type DashboardMember = {
  user: {
    id: string;
    username: string;
  };
  profile: {
    classes: string[];
    power: number;
    avatar_key: string | null;
  };
};

export type DashboardUpcomingEventRow = {
  item: Event;
  startsSoon: boolean;
  hasConflict: boolean;
  members: DashboardMember[];
  joined: boolean;
  capacityLabel: string;
  isFull: boolean;
};

export type DashboardLastWarMvpEntry = {
  category: string;
  label: string;
  name: string;
  initials: string;
  value: number;
};

export type DashboardLastWarMvp = DashboardLastWarMvpEntry[] | null;

export type DashboardMySignupEvent = {
  event: Event;
  participantCount: number;
};
