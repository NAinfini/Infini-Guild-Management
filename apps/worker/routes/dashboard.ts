import { activeGame } from "@guild/shared/games";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  eventParticipants,
  events,
  memberProfiles,
  users,
  warHistory,
  warTeamMembers,
  warTeams,
} from "../db/schema";
import { getRequestUser } from "../middleware/rbac";
import { parseStringArray } from "../services/helpers";
import { toEventPayload, type EventRow } from "../services/EventService";
import { toWarHistoryPayload } from "../services/GuildWarService";
import { getDb } from "./_shared";

export const dashboardRoutes = new Hono();

const UPCOMING_EVENT_LIMIT = 20;
const RECENT_WAR_LIMIT = 4;

function weekWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: now.toISOString(), end: end.toISOString() };
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

dashboardRoutes.get("/summary", async (c) => {
  const db = getDb(c);
  const viewer = await getRequestUser(c);
  const window = weekWindow();

  const [memberStatsRows, upcomingEventRows, recentWarRows, warStatsRows] = await Promise.all([
    db
      .select({
        activeMembers: sql<number>`sum(case when ${users.deletedAt} is null and ${users.isActive} = 1 then 1 else 0 end)`,
        totalMembers: sql<number>`sum(case when ${users.deletedAt} is null then 1 else 0 end)`,
      })
      .from(users),
    db
      .select({
        id: events.id,
        type: events.type,
        title: events.title,
        description: events.description,
        startAt: events.startAt,
        endAt: events.endAt,
        capacity: events.capacity,
        pinned: events.pinned,
        signupLocked: events.signupLocked,
        visibleAt: events.visibleAt,
        archivedAt: events.archivedAt,
        autoArchive: events.autoArchive,
        autoArchived: events.autoArchived,
        createdBy: events.createdBy,
        updatedBy: events.updatedBy,
        attachments: events.attachments,
        seriesId: events.seriesId,
        instanceDate: events.instanceDate,
        winnerCount: events.winnerCount,
        createdAt: events.createdAt,
        updatedAt: events.updatedAt,
      })
      .from(events)
      .where(and(isNull(events.archivedAt), gte(events.startAt, window.start), lte(events.startAt, window.end)))
      .orderBy(asc(events.startAt), asc(events.id))
      .limit(UPCOMING_EVENT_LIMIT),
    db
      .select()
      .from(warHistory)
      .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
      .limit(RECENT_WAR_LIMIT),
    db
      .select({
        total: sql<number>`count(*)`,
        wins: sql<number>`sum(case when ${warHistory.result} = 'win' then 1 else 0 end)`,
      })
      .from(warHistory)
      .where(isNotNull(warHistory.result)),
  ]);

  const eventIds = upcomingEventRows.map((row) => row.id);
  const warIds = recentWarRows.map((row) => row.id);

  const [participantRows, warMemberRows] = await Promise.all([
    eventIds.length > 0
      ? db
          .select({
            eventId: eventParticipants.eventId,
            userId: users.id,
            username: users.username,
            role: users.role,
            classes: memberProfiles.classes,
            power: memberProfiles.power,
            avatarKey: memberProfiles.avatarKey,
          })
          .from(eventParticipants)
          .innerJoin(users, eq(users.id, eventParticipants.userId))
          .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
          .where(and(inArray(eventParticipants.eventId, eventIds), isNull(users.deletedAt), eq(users.isActive, true)))
          .orderBy(eventParticipants.joinedAt, users.username)
      : Promise.resolve([]),
    warIds.length > 0
      ? db
          .select({
            warHistoryId: warTeams.warHistoryId,
            userId: warTeamMembers.userId,
            username: users.username,
            stats: warTeamMembers.stats,
          })
          .from(warTeamMembers)
          .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
          .innerJoin(users, eq(users.id, warTeamMembers.userId))
          .where(inArray(warTeams.warHistoryId, warIds))
      : Promise.resolve([]),
  ]);

  const participantsByEvent = new Map<string, unknown[]>();
  const mySignupEventIds = new Set<string>();
  for (const row of participantRows) {
    if (viewer?.id && row.userId === viewer.id) {
      mySignupEventIds.add(row.eventId);
    }
    const list = participantsByEvent.get(row.eventId) ?? [];
    list.push({
      user_id: row.userId,
      username: row.username,
      role: row.role,
      classes: parseStringArray(row.classes ?? "[]"),
      power: Number(row.power ?? 0),
      avatar_key: row.avatarKey ?? null,
    });
    participantsByEvent.set(row.eventId, list);
  }

  const mvpCategories = activeGame.war.mvpCategories;
  const warMembersByHistory = new Map<string, typeof warMemberRows>();
  for (const member of warMemberRows) {
    if (!member.warHistoryId) continue;
    warMembersByHistory.set(member.warHistoryId, [...(warMembersByHistory.get(member.warHistoryId) ?? []), member]);
  }

  const recentWarMvps = recentWarRows.map((war) => {
    const members = warMembersByHistory.get(war.id) ?? [];
    if (members.length === 0) return null;
    return mvpCategories.map((category) => {
      let top = members[0]!;
      for (const member of members.slice(1)) {
        if ((member.stats?.[category] ?? 0) > (top.stats?.[category] ?? 0)) {
          top = member;
        }
      }
      return {
        category,
        label: category,
        name: top.username,
        initials: initials(top.username),
        value: top.stats?.[category] ?? 0,
      };
    });
  });

  const warStats = warStatsRows[0];
  const allWarWinRate = !warStats || Number(warStats.total) === 0
    ? 0
    : (Number(warStats.wins) / Number(warStats.total)) * 100;
  const memberStats = memberStatsRows[0];

  return c.json({
    active_member_count: Number(memberStats?.activeMembers ?? 0),
    total_member_count: Number(memberStats?.totalMembers ?? 0),
    active_events_count: upcomingEventRows.length,
    all_war_win_rate: allWarWinRate,
    upcoming_events: upcomingEventRows.map((row) => ({
      ...toEventPayload(row as EventRow),
      participants: participantsByEvent.get(row.id) ?? [],
    })),
    my_signup_event_ids: Array.from(mySignupEventIds),
    recent_wars: recentWarRows.map(toWarHistoryPayload),
    recent_war_mvps: recentWarMvps,
  });
});
