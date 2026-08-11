import { DEFAULT_GAME_RULES, findEventTypeDefinition } from "@guild/shared";
import {
  CalendarEventIcon,
  ChartBarIcon,
  FriendsIcon,
  GiftIcon,
  SwordsIcon,
  TargetArrowIcon,
} from "@portal/components/icons";
import type { ComponentType } from "react";

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  calendar: CalendarEventIcon,
  target: TargetArrowIcon,
  swords: SwordsIcon,
  users: FriendsIcon,
  poll: ChartBarIcon,
  gift: GiftIcon,
};

export function EventTypeIcon({ eventType, size = 12 }: { eventType: string; size?: number }) {
  const iconId = findEventTypeDefinition(DEFAULT_GAME_RULES, eventType)?.icon ?? "calendar";
  const Icon = ICONS[iconId] ?? CalendarEventIcon;
  return <Icon size={size} />;
}
