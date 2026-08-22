import type { Event } from "@guild/shared";
import type { EventQuotaBarSummary } from "../feature/events/EventQuotaBar";
import { eventTypeColor } from "@portal/utils/event-colors";
import { Group, Title } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";

export function eventTypeTagColor(value: string): string {
  return eventTypeColor(value);
}

export function cardHeading(text: string, icon?: ReactNode) {
  return (
    <Group gap={8} align="center" wrap="nowrap" className="dashboard-card-title">
      {icon ? <span className="dashboard-card-title-icon">{icon}</span> : null}
      <Title order={2} className="dashboard-card-title__text">
        {text}
      </Title>
    </Group>
  );
}

/**
 * 比例计：把「几分之几」画出来，只给有分母的指标用。
 *
 * 三个 KPI 里有两个本来就是比例（活跃/总人数、胜率），但卡片只印了分子，
 * 比例这层信息在版面上是丢掉的——一眼扫过去 43 和 91% 一样重。
 *
 * aria-hidden 是有意的：同一个 <dl> 里的 <dd> 已经把数字念出来了，
 * 这条只是同一份信息的第二种编码，读屏再念一遍是噪音。
 */
export function KpiMeter({ ratio }: { ratio: number }) {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return (
    <div className="dashboard-kpi__meter" aria-hidden>
      <span
        className="dashboard-kpi__meter-fill"
        style={{ "--kpi-ratio": clamped } as CSSProperties}
      />
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
    username: string;
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
