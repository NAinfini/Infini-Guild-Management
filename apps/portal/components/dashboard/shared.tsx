import type { Event } from "@guild/shared";
import type { EventQuotaBarSummary } from "../feature/events/EventQuotaBar";
import { eventTypeColor } from "@portal/utils/event-colors";
import type { ReactNode } from "react";

export function eventTypeTagColor(value: string): string {
  return eventTypeColor(value);
}

export function cardHeading(text: string, icon?: ReactNode) {
  return (
    <div className="dashboard-card-title">
      {icon ? <span className="dashboard-card-title-icon">{icon}</span> : null}
      <h2 className="dashboard-card-title__text">
        {text}
      </h2>
    </div>
  );
}

export function orderDashboardUpcomingRows<
  T extends { item: Pick<Event, "id" | "start_at" | "pinned"> },
>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.item.start_at).getTime();
    const rightTime = new Date(right.item.start_at).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    if (left.item.pinned !== right.item.pinned) return left.item.pinned ? -1 : 1;
    return left.item.id.localeCompare(right.item.id);
  });
}

export type DashboardMember = {
  user: {
    id: string;
    display_name: string;
  };
  profile: {
    classes: string[];
    power: number;
    avatar_media_id: string | null;
  };
};

export type DashboardUpcomingEventRow = {
  item: Event;
  startsSoon: boolean;
  hasConflict: boolean;
  members: DashboardMember[];
  participantCount: number;
  joined: boolean;
  capacityLabel: string;
  isFull: boolean;
  /** 没配过配额的活动是 null，整行筹码不渲染。 */
  quotaSummary: EventQuotaBarSummary | null;
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
