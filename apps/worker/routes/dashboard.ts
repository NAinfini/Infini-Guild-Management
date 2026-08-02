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
import { parseStringArray } from "../services/helpers";
import { eventPublicVisibilityFilter } from "../services/events/event-visibility";
import { toEventPayload, type EventRow } from "../services/EventService";
import type { RawDbLike } from "../services/events/EventCrudService";
import {
  EVENT_CLASS_QUOTA_TABLE,
  loadClassQuotas,
  typeSupportsClassQuotas,
} from "../services/events/event-class-quotas";
import { toWarHistoryPayload } from "../services/GuildWarService";
import type { SessionUser } from "../services/auth";
import type { Bindings } from "../index";
import { getRequestUser } from "../middleware/rbac";
import { getDb } from "./_shared";
import { getFeatureFlags } from "./service-factory";

export const dashboardRoutes = new Hono();

const UPCOMING_EVENT_GROUP_LIMIT = 5;
const RECENT_WAR_LIMIT = 4;

const DASHBOARD_EVENT_FIELDS = {
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
} as const;

function weekWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: now.toISOString(), end: end.toISOString() };
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

type DashboardDb = ReturnType<typeof getDb>;

async function loadMemberStats(db: DashboardDb) {
  const rows = await db
    .select({
      activeMembers: sql<number>`sum(case when ${users.deletedAt} is null and ${users.isActive} = 1 then 1 else 0 end)`,
      totalMembers: sql<number>`sum(case when ${users.deletedAt} is null then 1 else 0 end)`,
    })
    .from(users);
  const stats = rows[0];

  return {
    active_member_count: Number(stats?.activeMembers ?? 0),
    total_member_count: Number(stats?.totalMembers ?? 0),
  };
}

async function loadUpcomingEvents(
  db: DashboardDb,
  rawDb: RawDbLike,
  viewer: SessionUser | null,
) {
  const window = weekWindow();
  const eventVisibilityFilter = viewer?.permissions.has("events.edit")
    ? undefined
    : eventPublicVisibilityFilter(window.start);
  const upcomingEventFilter = and(
    isNull(events.archivedAt),
    gte(events.startAt, window.start),
    lte(events.startAt, window.end),
    eventVisibilityFilter,
  );

  const [
    featuredEventRows,
    upcomingEventRows,
    upcomingEventCountRows,
  ] = await Promise.all([
    db
      .select(DASHBOARD_EVENT_FIELDS)
      .from(events)
      .where(and(upcomingEventFilter, eq(events.pinned, true)))
      .orderBy(asc(events.startAt), asc(events.id))
      .limit(UPCOMING_EVENT_GROUP_LIMIT),
    db
      .select(DASHBOARD_EVENT_FIELDS)
      .from(events)
      .where(and(upcomingEventFilter, eq(events.pinned, false)))
      .orderBy(asc(events.startAt), asc(events.id))
      .limit(UPCOMING_EVENT_GROUP_LIMIT),
    db
      .select({ total: sql<number>`count(*)` })
      .from(events)
      .where(upcomingEventFilter),
  ]);

  const dashboardEventRows = [...featuredEventRows, ...upcomingEventRows];
  const eventIds = dashboardEventRows.map((row) => row.id);
  /* 面板上的活动条也要能看出「还缺什么」，所以这里得跟活动列表一样把配额读出来。
     投票和抽奖存不进配额，不必为它们白查一遍。 */
  const quotasByEvent = await loadClassQuotas(
    rawDb,
    EVENT_CLASS_QUOTA_TABLE,
    dashboardEventRows.filter((row) => typeSupportsClassQuotas(row.type)).map((row) => row.id),
  );
  const participantRows = eventIds.length > 0
    ? await db
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
    : [];

  const participantsByEvent = new Map<string, unknown[]>();
  const mySignupEventIds = new Set<string>();
  for (const row of participantRows) {
    if (viewer && row.userId === viewer.id) {
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

  const toDashboardEvent = (row: (typeof dashboardEventRows)[number]) => ({
    ...toEventPayload({ ...row, classQuotas: quotasByEvent.get(row.id) ?? [] } as EventRow),
    participants: participantsByEvent.get(row.id) ?? [],
  });

  return {
    active_events_count: Number(upcomingEventCountRows[0]?.total ?? 0),
    featured_events: featuredEventRows.map(toDashboardEvent),
    upcoming_events: upcomingEventRows.map(toDashboardEvent),
    my_signup_event_ids: Array.from(mySignupEventIds),
  };
}

async function loadWarStats(db: DashboardDb) {
  const [recentWarRows, warStatsRows] = await Promise.all([
    db
      .select({
        id: warHistory.id,
        eventId: warHistory.eventId,
        warName: warHistory.warName,
        enemyName: warHistory.enemyName,
        result: warHistory.result,
        ownStats: warHistory.ownStats,
        enemyStats: warHistory.enemyStats,
        durationMinutes: warHistory.durationMinutes,
        notes: warHistory.notes,
        createdBy: warHistory.createdBy,
        updatedBy: warHistory.updatedBy,
        createdAt: warHistory.createdAt,
        updatedAt: warHistory.updatedAt,
      })
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

  const warIds = recentWarRows.map((row) => row.id);
  const warMemberRows = warIds.length > 0
    ? await db
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
    : [];

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

  return {
    all_war_win_rate: allWarWinRate,
    recent_wars: recentWarRows.map(toWarHistoryPayload),
    recent_war_mvps: recentWarMvps,
  };
}

dashboardRoutes.get("/members", async (c) => {
  return c.json(await loadMemberStats(getDb(c)));
});

dashboardRoutes.get("/events", async (c) => {
  const features = await getFeatureFlags(c);
  if (!features.events) {
    return c.json({
      active_events_count: 0,
      featured_events: [],
      upcoming_events: [],
      my_signup_event_ids: [],
    });
  }

  // External preview must use the same public visibility rules as a guest,
  // even when the current session belongs to an event editor.
  const viewer = c.req.query("external_view") === "true"
    ? null
    : await getRequestUser(c);
  return c.json(await loadUpcomingEvents(getDb(c), (c.env as Bindings).DB as never, viewer));
});

dashboardRoutes.get("/wars", async (c) => {
  const features = await getFeatureFlags(c);
  if (!features.guildWar) {
    return c.json({
      all_war_win_rate: 0,
      recent_wars: [],
      recent_war_mvps: [],
    });
  }

  return c.json(await loadWarStats(getDb(c)));
});
