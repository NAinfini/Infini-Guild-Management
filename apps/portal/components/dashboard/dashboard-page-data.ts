import type { DashboardAttentionSummary } from "./DashboardAttentionCard";
import type { DashboardMember, DashboardUpcomingEventRow } from "./shared";
import type { DashboardEvent } from "../../services/DashboardService";

export type DashboardAttentionKind = keyof DashboardAttentionSummary;

export const DASHBOARD_CLOCK_TICK_MS = 60_000;

export function roundDashboardNow(value = new Date()): Date {
  const rounded = new Date(value);
  rounded.setMinutes(Math.floor(rounded.getMinutes() / 5) * 5, 0, 0);
  return rounded;
}

export function participantToDashboardMember(
  participant: DashboardEvent["participant_preview"][number],
): DashboardMember {
  return {
    user: {
      id: participant.user_id,
      display_name: participant.display_name,
    },
    profile: {
      power: participant.power,
      classes: participant.classes,
      avatar_media_id: participant.avatar_media_id,
    },
  };
}

export function isDashboardEventStartingSoon(startsAt: Date, now: Date): boolean {
  const millisecondsUntilStart = startsAt.getTime() - now.getTime();
  return millisecondsUntilStart >= 0 && millisecondsUntilStart <= 6 * 60 * 60 * 1_000;
}

export function buildUpcomingEventRow(
  item: DashboardEvent,
  source: DashboardEvent[],
  now: Date,
  joined: boolean,
): DashboardUpcomingEventRow {
  const startsAt = new Date(item.start_at);
  const endsAt = item.end_at ? new Date(item.end_at) : startsAt;
  const startsSoon = isDashboardEventStartingSoon(startsAt, now);
  const hasConflict = source.some((peer) => {
    if (peer.id === item.id) return false;
    const peerStart = new Date(peer.start_at);
    const peerEnd = peer.end_at ? new Date(peer.end_at) : peerStart;
    return startsAt < peerEnd && peerStart < endsAt;
  });
  const participantCount = item.participant_count;
  const capacityLabel = item.capacity === null ? `${participantCount}/∞` : `${participantCount}/${item.capacity}`;
  const members = item.participant_preview.map(participantToDashboardMember);

  return {
    item,
    startsSoon,
    hasConflict,
    members,
    participantCount,
    joined,
    capacityLabel,
    isFull: item.capacity !== null && participantCount >= item.capacity,
    quotaSummary: item.quota_summary && {
      slots: item.quota_summary.slots.map((slot) => ({
        key: slot.tag_id,
        required: slot.required,
        matched: slot.matched,
        eligible: slot.eligible,
      })),
      requiredTotal: item.quota_summary.required_total,
      matchedTotal: item.quota_summary.matched_total,
    },
  };
}

export function summarizeDashboardAttention(
  rows: DashboardUpcomingEventRow[],
): DashboardAttentionSummary {
  return rows.reduce<DashboardAttentionSummary>((summary, row) => {
    for (const kind of getDashboardAttentionKinds(row)) summary[kind] += 1;
    return summary;
  }, { startsSoon: 0, conflicts: 0, full: 0, quotaShortfalls: 0 });
}

export function getDashboardAttentionKinds(
  row: DashboardUpcomingEventRow,
): DashboardAttentionKind[] {
  const kinds: DashboardAttentionKind[] = [];
  if (row.startsSoon) kinds.push("startsSoon");
  if (row.hasConflict) kinds.push("conflicts");
  if (row.isFull) kinds.push("full");
  if (row.quotaSummary && row.quotaSummary.matchedTotal < row.quotaSummary.requiredTotal) {
    kinds.push("quotaShortfalls");
  }
  return kinds;
}
