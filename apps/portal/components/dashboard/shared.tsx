import type { Event, MemberProfile, User } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
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

const EVENT_TYPE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  activeGame.eventTypes.map((et) => [et.id, et.color]),
);

export function eventTypeTagColor(value: string): string {
  return EVENT_TYPE_COLOR_MAP[value] ?? "blue";
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
  user: User;
  profile: MemberProfile;
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
