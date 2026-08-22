import { AppError } from "@guild/kernel";
import type {
  DashboardEventRead,
  DashboardEventsRead,
  DashboardQuotaSummaryRead,
  DashboardWarsRead,
  PortalReadModelStore,
  SearchResultRead,
} from "@guild/server/modules/portal-read-models";
import type { EventAggregate, EventRecord } from "@guild/server/modules/events";
import type { GuildWarRecord, MemberStats, TeamStats } from "@guild/server/modules/guild-war";
import { LIMITS, type EventClassQuota } from "@guild/shared";
import { summariseClassQuotas } from "@guild/shared/utils/class-quota";
import { EVENT_TYPES, type EventType } from "@guild/shared/constants/event-types";
import {
  LOWER_IS_BETTER_WAR_STAT_KEYS,
  WAR_MVP_STAT_KEYS,
  WAR_RESULTS,
  type WarMemberStatKey,
  type WarResult,
} from "@guild/shared/constants/guild-war";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";

const DASHBOARD_EVENTS_PER_GROUP = 5;
const DASHBOARD_EVENT_LIMIT = DASHBOARD_EVENTS_PER_GROUP * 2;
const DASHBOARD_PARTICIPANT_PREVIEW_PER_EVENT = 5;
const DASHBOARD_PARTICIPANT_PREVIEW_LIMIT =
  DASHBOARD_EVENT_LIMIT * DASHBOARD_PARTICIPANT_PREVIEW_PER_EVENT;
const DASHBOARD_QUOTA_LIMIT =
  DASHBOARD_EVENT_LIMIT * LIMITS.content.eventClassQuotas.max;
const DASHBOARD_ELIGIBILITY_SIGNATURE_LIMIT =
  DASHBOARD_EVENT_LIMIT * LIMITS.content.eventParticipantsPerEvent.max;
const DASHBOARD_ATTACHMENT_LIMIT =
  DASHBOARD_EVENT_LIMIT * LIMITS.content.eventAttachments.max;
const RECENT_WAR_LIMIT = 4;
const RECENT_WAR_MEMBER_LIMIT = 4_000;
const EVENT_RESULT_COLUMNS = [
  "id", "type", "title", "description", "start_at", "end_at", "capacity", "pinned", "signup_locked",
  "auto_archive", "auto_archived", "visible_at", "archived_at", "created_by", "updated_by", "series_id",
  "instance_date", "winner_count", "created_at", "updated_at",
] as const;
const WAR_RESULT_COLUMNS = [
  "id", "event_id", "war_name", "enemy_name", "result", "own_kills", "own_towers", "own_base_hp", "own_credits",
  "own_distance", "enemy_kills", "enemy_towers", "enemy_base_hp", "enemy_credits", "enemy_distance",
  "duration_minutes", "notes", "created_by", "updated_by", "created_at", "updated_at", "roster_version", "concluded_at",
] as const;

const EVENT_COLUMNS = `
  e.id, e.type, e.title, e.description, e.start_at, e.end_at, e.capacity,
  e.pinned, e.signup_locked, e.auto_archive, e.auto_archived, e.visible_at,
  e.archived_at, e.created_by, e.updated_by, e.series_id, e.instance_date,
  e.winner_count, e.created_at, e.updated_at`;

const WAR_COLUMNS = `
  gw.id, gw.event_id, gw.war_name, gw.enemy_name, gw.result,
  gw.own_kills, gw.own_towers, gw.own_base_hp, gw.own_credits, gw.own_distance,
  gw.enemy_kills, gw.enemy_towers, gw.enemy_base_hp, gw.enemy_credits, gw.enemy_distance,
  gw.duration_minutes, gw.notes, gw.created_by, gw.updated_by, gw.created_at,
  gw.updated_at, gw.roster_version, gw.concluded_at`;

export class SqlitePortalReadModelStore implements PortalReadModelStore {
  constructor(private readonly sql: SqlExecutor) {}

  async dashboardMembers() {
    const result = await this.sql.execute({
      method: "get",
      sql: `SELECT
        sum(CASE WHEN deleted_at IS NULL AND is_active = 1 THEN 1 ELSE 0 END),
        sum(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END)
      FROM users INDEXED BY idx_users_roster`,
    });
    const row = singleRow(result, "dashboard member totals");
    return {
      activeMemberCount: integerOrZero(row?.[0]),
      totalMemberCount: integerOrZero(row?.[1]),
    };
  }

  async dashboardEvents(input: Readonly<{
    now: string;
    windowEnd: string;
    viewerUserId: string | null;
    canViewHidden: boolean;
  }>): Promise<DashboardEventsRead> {
    const selected = selectedEventsCte(input.canViewHidden);
    const params = selectionParams(input);
    const results = await this.sql.batch([
      {
        method: "all",
        columns: [...EVENT_RESULT_COLUMNS, "participant_count", "viewer_signed_up"],
        sql: `${selected}
          SELECT ${EVENT_COLUMNS},
            (SELECT count(*)
              FROM event_participants ep
              JOIN users u ON u.id = ep.user_id AND u.deleted_at IS NULL AND u.is_active = 1
              WHERE ep.event_id = e.id) AS participant_count,
            EXISTS (
              SELECT 1
              FROM event_participants ep
              JOIN users u ON u.id = ep.user_id AND u.deleted_at IS NULL AND u.is_active = 1
              WHERE ep.event_id = e.id AND ep.user_id = ?
            ) AS viewer_signed_up
          FROM selected_events e
          ORDER BY e.pinned DESC, e.start_at, e.id`,
        params: [...params, input.viewerUserId],
      },
      {
        method: "get",
        columns: ["total"],
        sql: `SELECT count(*) AS total
          FROM events e
          WHERE e.archived_at IS NULL
            AND e.start_at >= ? AND e.start_at <= ?
            ${input.canViewHidden ? "" : "AND (e.visible_at IS NULL OR e.visible_at <= ?)"}
            AND EXISTS (SELECT 1 FROM site_config sc WHERE sc.singleton = 1 AND sc.feature_events = 1)`,
        params,
      },
      {
        method: "all",
        columns: ["event_id", "id", "username", "role_id", "power", "class_ids_json", "avatar_media_id"],
        sql: `${selected}, ranked_participants AS (
          SELECT ep.event_id, u.id, u.username, u.role_id, coalesce(mp.power, 0) AS power,
            ep.joined_at, ep.id AS participant_id,
            row_number() OVER (PARTITION BY ep.event_id ORDER BY ep.joined_at, ep.id) AS preview_rank
          FROM selected_events se
          JOIN event_participants ep INDEXED BY idx_event_participants_event_joined ON ep.event_id = se.id
          JOIN users u ON u.id = ep.user_id AND u.deleted_at IS NULL AND u.is_active = 1
          LEFT JOIN member_profiles mp ON mp.user_id = u.id
          )
          SELECT rp.event_id, rp.id, rp.username, rp.role_id, rp.power,
            coalesce((
              SELECT json_group_array(class_id)
              FROM (
                SELECT mpc.class_id
                FROM member_profile_classes mpc
                WHERE mpc.user_id = rp.id
                ORDER BY mpc.sort_order, mpc.class_id
              )
            ), '[]') AS class_ids_json,
            (SELECT ml.media_id
              FROM media_links ml INDEXED BY ux_media_links_target_order
              WHERE ml.entity_type = 'member_profile' AND ml.entity_id = rp.id
                AND ml.slot = 'avatar' AND ml.audience = 'public'
              ORDER BY ml.sort_order, ml.media_id
              LIMIT 1) AS avatar_media_id
          FROM ranked_participants rp
          WHERE rp.preview_rank <= ${DASHBOARD_PARTICIPANT_PREVIEW_PER_EVENT}
          ORDER BY rp.event_id, rp.preview_rank
          LIMIT ${DASHBOARD_PARTICIPANT_PREVIEW_LIMIT + 1}`,
        params,
      },
      {
        method: "all",
        columns: ["event_id", "tag_id", "required", "label", "owner_kind", "class_ids_json"],
        sql: `${selected}
          SELECT eq.event_id, eq.tag_id, eq.required, ct.label, ct.owner_kind,
            coalesce((
              SELECT json_group_array(class_id)
              FROM (
                SELECT ctm.class_id
                FROM class_tag_members ctm
                WHERE ctm.tag_id = ct.id
                ORDER BY ctm.class_id
              )
            ), '[]') AS class_ids_json
          FROM selected_events se
          JOIN event_class_quotas eq ON eq.event_id = se.id
          JOIN class_tags ct ON ct.id = eq.tag_id
          ORDER BY eq.event_id, ct.sort_order, ct.id
          LIMIT ${DASHBOARD_QUOTA_LIMIT + 1}`,
        params,
      },
      {
        method: "all",
        columns: ["event_id", "eligible_tag_ids_json", "participant_count"],
        sql: `${selected}, active_participants AS (
            SELECT ep.event_id, ep.user_id
            FROM selected_events se
            JOIN event_participants ep INDEXED BY idx_event_participants_event_joined ON ep.event_id = se.id
            JOIN users u ON u.id = ep.user_id AND u.deleted_at IS NULL AND u.is_active = 1
            WHERE EXISTS (SELECT 1 FROM event_class_quotas eq WHERE eq.event_id = se.id)
          ), participant_quota_matches AS (
            SELECT DISTINCT ap.event_id, ap.user_id, eq.tag_id
            FROM active_participants ap
            JOIN member_profile_classes mpc ON mpc.user_id = ap.user_id
            JOIN class_tag_members ctm ON ctm.class_id = mpc.class_id
            JOIN event_class_quotas eq ON eq.event_id = ap.event_id AND eq.tag_id = ctm.tag_id
          ), participant_signatures AS (
            SELECT event_id, user_id, json_group_array(tag_id) AS eligible_tag_ids_json
            FROM (
              SELECT event_id, user_id, tag_id
              FROM participant_quota_matches
              ORDER BY event_id, user_id, tag_id
            )
            GROUP BY event_id, user_id
          )
          SELECT ap.event_id, coalesce(ps.eligible_tag_ids_json, '[]') AS eligible_tag_ids_json,
            count(*) AS participant_count
          FROM active_participants ap
          LEFT JOIN participant_signatures ps
            ON ps.event_id = ap.event_id AND ps.user_id = ap.user_id
          GROUP BY ap.event_id, ps.eligible_tag_ids_json
          ORDER BY ap.event_id, ps.eligible_tag_ids_json
          LIMIT ${DASHBOARD_ELIGIBILITY_SIGNATURE_LIMIT + 1}`,
        params,
      },
      {
        method: "all",
        columns: ["entity_id", "media_id"],
        sql: `${selected}
          SELECT ml.entity_id, ml.media_id
          FROM selected_events se
          JOIN media_links ml INDEXED BY ux_media_links_target_order
            ON ml.entity_type = 'event' AND ml.entity_id = se.id AND ml.slot = 'attachment'
          ORDER BY ml.entity_id, ml.sort_order, ml.media_id
          LIMIT ${DASHBOARD_ATTACHMENT_LIMIT + 1}`,
        params,
      },
    ]);

    const eventRows = boundedRows(results[0], DASHBOARD_EVENT_LIMIT, "dashboard events");
    const participantRows = boundedRows(
      results[2],
      DASHBOARD_PARTICIPANT_PREVIEW_LIMIT,
      "dashboard participant preview",
    );
    const quotaRows = boundedRows(results[3], DASHBOARD_QUOTA_LIMIT, "dashboard quotas");
    const eligibilityRows = boundedRows(
      results[4],
      DASHBOARD_ELIGIBILITY_SIGNATURE_LIMIT,
      "dashboard eligibility signatures",
    );
    const attachmentRows = boundedRows(results[5], DASHBOARD_ATTACHMENT_LIMIT, "dashboard attachments");

    const participantPreviewByEvent = new Map<string, DashboardEventRead["participantPreview"][number][]>();
    for (const row of participantRows) {
      const eventId = text(row[0], "participant event id");
      const userId = text(row[1], "participant user id");
      const classes = stringArrayJson(row[5], "participant classes");
      if (classes.length > LIMITS.content.classesPerProfile.max) throw invalidRow("participant classes");
      const list = participantPreviewByEvent.get(eventId) ?? [];
      list.push({
        userId,
        username: text(row[2], "participant username"),
        roleId: text(row[3], "participant role"),
        power: nonnegativeNumber(row[4], "participant power"),
        classes,
        avatarMediaId: nullableText(row[6], "participant avatar"),
      });
      participantPreviewByEvent.set(eventId, list);
    }

    const quotasByEvent = quotaMap(quotaRows);
    const quotaSummariesByEvent = quotaSummaryMap(quotasByEvent, eligibilityRows);
    const attachmentsByEvent = stringListMap(attachmentRows, "dashboard attachments");
    const events = eventRows.map((row) => {
      const event = eventRecord(row);
      return {
        aggregate: {
          event,
          attachments: attachmentsByEvent.get(event.id) ?? [],
          classQuotas: quotasByEvent.get(event.id) ?? [],
          poll: null,
          raffleWinners: [],
          participants: [],
        } satisfies EventAggregate,
        participantCount: integer(row[20], "dashboard participant count"),
        participantPreview: participantPreviewByEvent.get(event.id) ?? [],
        quotaSummary: quotaSummariesByEvent.get(event.id) ?? null,
      } satisfies DashboardEventRead;
    });
    return {
      activeEventCount: integerOrZero(singleRow(results[1], "dashboard event count")?.[0]),
      featuredEvents: events.filter(({ aggregate }) => aggregate.event.pinned),
      upcomingEvents: events.filter(({ aggregate }) => !aggregate.event.pinned),
      mySignupEventIds: events
        .filter((_, index) => boolean(eventRows[index]?.[21], "viewer signup"))
        .map(({ aggregate }) => aggregate.event.id),
    };
  }

  async dashboardWars(): Promise<DashboardWarsRead> {
    const recent = `WITH recent_wars AS (
      SELECT * FROM guild_wars gw INDEXED BY idx_guild_wars_history_created
      WHERE gw.status = 'concluded'
        AND EXISTS (SELECT 1 FROM site_config sc WHERE sc.singleton = 1 AND sc.feature_guild_war = 1)
      ORDER BY gw.created_at DESC, gw.id DESC
      LIMIT ${RECENT_WAR_LIMIT}
    )`;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: WAR_RESULT_COLUMNS,
        sql: `${recent}
          SELECT ${WAR_COLUMNS}
          FROM recent_wars gw
          ORDER BY gw.created_at DESC, gw.id DESC`,
      },
      {
        method: "get",
        columns: ["total", "wins"],
        sql: `SELECT count(*) AS total,
            coalesce(sum(CASE WHEN gw.result = 'win' THEN 1 ELSE 0 END), 0) AS wins
          FROM guild_wars gw INDEXED BY idx_guild_wars_history_created
          WHERE gw.status = 'concluded'
            AND EXISTS (SELECT 1 FROM site_config sc WHERE sc.singleton = 1 AND sc.feature_guild_war = 1)`,
      },
      {
        method: "all",
        columns: ["id", "user_id", "username", "damage", "healing", "damage_taken", "building_damage"],
        sql: `${recent}
          SELECT rw.id, wm.user_id, u.username,
            wm.damage, wm.healing, wm.damage_taken, wm.building_damage
          FROM recent_wars rw
          JOIN war_members wm INDEXED BY idx_war_members_war_pool_sort
            ON wm.war_id = rw.id AND wm.team_id IS NOT NULL
          JOIN users u ON u.id = wm.user_id
          ORDER BY rw.created_at DESC, rw.id DESC, u.username, u.id
          LIMIT ${RECENT_WAR_MEMBER_LIMIT + 1}`,
      },
    ]);
    const wars = rows(results[0], "dashboard wars").map(warRecord);
    const memberRows = boundedRows(results[2], RECENT_WAR_MEMBER_LIMIT, "dashboard war members");
    const membersByWar = new Map<string, Array<Readonly<{
      name: string;
      stats: MemberStats;
    }>>>();
    for (const row of memberRows) {
      const warId = text(row[0], "MVP war id");
      const list = membersByWar.get(warId) ?? [];
      list.push({
        name: text(row[2], "MVP username"),
        stats: {
          damage: nullableNumber(row[3], "damage"),
          healing: nullableNumber(row[4], "healing"),
          damage_taken: nullableNumber(row[5], "damage_taken"),
          building_damage: nullableNumber(row[6], "building_damage"),
        },
      });
      membersByWar.set(warId, list);
    }
    const totals = singleRow(results[1], "dashboard war totals");
    const total = integerOrZero(totals?.[0]);
    const wins = integerOrZero(totals?.[1]);
    return {
      allWarWinRate: total === 0 ? 0 : (wins / total) * 100,
      recentWars: wars,
      recentWarMvps: wars.map((war) => mvps(membersByWar.get(war.id) ?? [])),
    };
  }

  async search(input: Readonly<{
    query: string;
    limit: number;
    perTypeLimit: number;
    now: string;
  }>): Promise<readonly SearchResultRead[]> {
    const pattern = `%${escapeLike(input.query.toLocaleLowerCase("en-US"))}%`;
    const enabled = (column: string) => `EXISTS (
      SELECT 1 FROM site_config sc WHERE sc.singleton = 1 AND sc.${column} = 1
    )`;
    const statements: SqlBatchStatement[] = [
      {
        method: "all",
        columns: ["id", "username", "role_id", "name", "color", "level", "power"],
        sql: `SELECT u.id, u.username, u.role_id, r.name, r.color, r.level, coalesce(mp.power, 0) AS power
          FROM users u INDEXED BY ux_users_username_nocase
          JOIN roles r ON r.id = u.role_id
          LEFT JOIN member_profiles mp ON mp.user_id = u.id
          WHERE u.deleted_at IS NULL AND u.is_active = 1
            AND lower(u.username) LIKE ? ESCAPE '\\'
          ORDER BY u.username COLLATE NOCASE, u.id
          LIMIT ?`,
        params: [pattern, input.perTypeLimit],
      },
      {
        method: "all",
        columns: ["id", "title", "type", "start_at"],
        sql: `SELECT e.id, e.title, e.type, e.start_at
          FROM events e INDEXED BY idx_events_list_start
          WHERE e.archived_at IS NULL AND (e.visible_at IS NULL OR e.visible_at <= ?)
            AND ${enabled("feature_events")}
            AND (lower(e.title) LIKE ? ESCAPE '\\' OR lower(coalesce(e.description, '')) LIKE ? ESCAPE '\\')
          ORDER BY e.start_at, e.id
          LIMIT ?`,
        params: [input.now, pattern, pattern, input.perTypeLimit],
      },
      {
        method: "all",
        columns: ["id", "title"],
        sql: `SELECT a.id, a.title
          FROM announcements a INDEXED BY idx_announcements_public
          WHERE a.status = 'published' AND a.archived_at IS NULL
            AND a.publish_at <= ? AND (a.expires_at IS NULL OR a.expires_at > ?)
            AND ${enabled("feature_announcements")}
            AND (lower(a.title) LIKE ? ESCAPE '\\' OR lower(a.search_text) LIKE ? ESCAPE '\\')
          ORDER BY a.pinned DESC, a.updated_at DESC, a.id DESC
          LIMIT ?`,
        params: [input.now, input.now, pattern, pattern, input.perTypeLimit],
      },
      {
        method: "all",
        columns: ["id", "title", "slug"],
        sql: `SELECT w.id, w.title, w.slug
          FROM wiki_articles w INDEXED BY idx_wiki_articles_visibility_updated
          WHERE w.deleted_at IS NULL AND w.archived_at IS NULL AND ${enabled("feature_wiki")}
            AND (lower(w.title) LIKE ? ESCAPE '\\' OR lower(w.search_text) LIKE ? ESCAPE '\\')
          ORDER BY w.updated_at DESC, w.id DESC
          LIMIT ?`,
        params: [pattern, pattern, input.perTypeLimit],
      },
      {
        method: "all",
        columns: ["id", "type", "caption"],
        sql: `SELECT g.id, g.type, g.caption
          FROM gallery_items g INDEXED BY idx_gallery_items_created
          WHERE ${enabled("feature_gallery")}
            AND lower(coalesce(g.caption, '')) LIKE ? ESCAPE '\\'
          ORDER BY g.created_at DESC, g.id DESC
          LIMIT ?`,
        params: [pattern, input.perTypeLimit],
      },
      {
        method: "all",
        columns: ["id", "war_name", "enemy_name"],
        sql: `SELECT gw.id, gw.war_name, gw.enemy_name
          FROM guild_wars gw INDEXED BY idx_guild_wars_history_created
          WHERE gw.status = 'concluded' AND ${enabled("feature_guild_war")}
            AND (lower(gw.war_name) LIKE ? ESCAPE '\\' OR lower(coalesce(gw.enemy_name, '')) LIKE ? ESCAPE '\\')
          ORDER BY gw.created_at DESC, gw.id DESC
          LIMIT ?`,
        params: [pattern, pattern, input.perTypeLimit],
      },
    ];
    const result = await this.sql.batch(statements);
    const userResults = rows(result[0], "member search").map((row): SearchResultRead => {
      const power = nonnegativeNumber(row[6], "search member power");
      const roleName = text(row[3], "search role name");
      return {
        id: text(row[0], "search member id"),
        title: text(row[1], "search username"),
        subtitle: power > 0 ? `${roleName} · ${Math.round(power).toLocaleString("en-US")} power` : roleName,
        type: "user",
        to: "/roster",
        entityId: text(row[0], "search member id"),
        roleId: text(row[2], "search role id"),
        roleName,
        roleColor: nullableText(row[4], "search role color"),
        roleLevel: integer(row[5], "search role level"),
      };
    });
    const eventResults = rows(result[1], "event search").map((row): SearchResultRead => ({
      id: text(row[0], "search event id"),
      title: text(row[1], "search event title"),
      subtitle: `${text(row[2], "search event type")} · ${text(row[3], "search event date").slice(0, 10)}`,
      type: "event",
      to: "/events",
      entityId: text(row[0], "search event id"),
    }));
    const announcementResults = rows(result[2], "announcement search").map((row): SearchResultRead => ({
      id: text(row[0], "search announcement id"),
      title: text(row[1], "search announcement title"),
      subtitle: "Announcement",
      type: "announcement",
      to: "/announcements",
      entityId: text(row[0], "search announcement id"),
    }));
    const wikiResults = rows(result[3], "wiki search").map((row): SearchResultRead => ({
      id: text(row[0], "search wiki id"),
      title: text(row[1], "search wiki title"),
      subtitle: "Wiki article",
      type: "wiki",
      to: "/wiki",
      entityId: text(row[2], "search wiki slug"),
    }));
    const galleryResults = rows(result[4], "gallery search").map((row): SearchResultRead => {
      const type = text(row[1], "search gallery type");
      const caption = nullableText(row[2], "search gallery caption")?.trim();
      return {
        id: text(row[0], "search gallery id"),
        title: caption || `${type.slice(0, 1).toUpperCase()}${type.slice(1)} item`,
        subtitle: "Gallery",
        type: "gallery",
        to: "/gallery",
        entityId: text(row[0], "search gallery id"),
      };
    });
    const warResults = rows(result[5], "war search").map((row): SearchResultRead => {
      const enemy = nullableText(row[2], "search enemy name");
      return {
        id: text(row[0], "search war id"),
        title: text(row[1], "search war title"),
        subtitle: enemy ? `vs ${enemy}` : "Guild war",
        type: "war",
        to: "/guild-war",
        entityId: text(row[0], "search war id"),
      };
    });
    return [
      ...userResults,
      ...eventResults,
      ...announcementResults,
      ...wikiResults,
      ...galleryResults,
      ...warResults,
    ].slice(0, input.limit);
  }
}

function selectedEventsCte(canViewHidden: boolean): string {
  return `WITH ranked_events AS (
    SELECT e.*, row_number() OVER (PARTITION BY e.pinned ORDER BY e.start_at, e.id) AS group_rank
    FROM events e
    WHERE e.archived_at IS NULL
      AND e.start_at >= ? AND e.start_at <= ?
      ${canViewHidden ? "" : "AND (e.visible_at IS NULL OR e.visible_at <= ?)"}
      AND EXISTS (SELECT 1 FROM site_config sc WHERE sc.singleton = 1 AND sc.feature_events = 1)
  ), selected_events AS (
    SELECT * FROM ranked_events WHERE group_rank <= ${DASHBOARD_EVENTS_PER_GROUP}
  )`;
}

function selectionParams(input: Readonly<{ now: string; windowEnd: string; canViewHidden: boolean }>): readonly SqlValue[] {
  return input.canViewHidden ? [input.now, input.windowEnd] : [input.now, input.windowEnd, input.now];
}

function eventRecord(row: readonly SqlValue[]): EventRecord {
  const type = text(row[1], "event type");
  if (!(EVENT_TYPES as readonly string[]).includes(type)) throw invalidRow("event type");
  return {
    id: text(row[0], "event id"),
    type: type as EventType,
    title: text(row[2], "event title"),
    description: nullableText(row[3], "event description"),
    startAt: text(row[4], "event start"),
    endAt: nullableText(row[5], "event end"),
    capacity: nullableInteger(row[6], "event capacity"),
    pinned: boolean(row[7], "event pinned"),
    signupLocked: boolean(row[8], "event signup lock"),
    autoArchive: boolean(row[9], "event auto archive"),
    autoArchived: boolean(row[10], "event auto archived"),
    visibleAt: nullableText(row[11], "event visible at"),
    archivedAt: nullableText(row[12], "event archived at"),
    createdBy: text(row[13], "event creator"),
    updatedBy: nullableText(row[14], "event updater"),
    seriesId: nullableText(row[15], "event series"),
    instanceDate: nullableText(row[16], "event instance date"),
    winnerCount: nullableInteger(row[17], "event winner count"),
    createdAt: text(row[18], "event created at"),
    updatedAt: text(row[19], "event updated at"),
  };
}

function quotaMap(input: readonly (readonly SqlValue[])[]): ReadonlyMap<string, readonly EventClassQuota[]> {
  const byEvent = new Map<string, EventClassQuota[]>();
  for (const row of input) {
    const eventId = text(row[0], "quota event id");
    const tagId = text(row[1], "quota tag id");
    const classIds = stringArrayJson(row[5], "quota classes");
    if (classIds.length > LIMITS.content.classesPerTag.max) throw invalidRow("quota classes");
    const list = byEvent.get(eventId) ?? [];
    list.push({
      tag_id: tagId,
      required: integer(row[2], "quota required"),
      label: nullableText(row[3], "quota label"),
      class_ids: classIds,
      one_time: row[4] !== null,
    });
    byEvent.set(eventId, list);
  }
  return byEvent;
}

function quotaSummaryMap(
  quotasByEvent: ReadonlyMap<string, readonly EventClassQuota[]>,
  input: readonly (readonly SqlValue[])[],
): ReadonlyMap<string, DashboardQuotaSummaryRead> {
  const signaturesByEvent = new Map<string, Array<Readonly<{ tagIds: readonly string[]; count: number }>>>();
  for (const row of input) {
    const eventId = text(row[0], "eligibility event id");
    const quotas = quotasByEvent.get(eventId);
    if (!quotas) throw invalidRow("eligibility event id");
    const knownTagIds = new Set(quotas.map((quota) => quota.tag_id));
    const tagIds = stringArrayJson(row[1], "eligibility tag ids");
    if (tagIds.some((tagId) => !knownTagIds.has(tagId))) throw invalidRow("eligibility tag ids");
    const count = integer(row[2], "eligibility participant count");
    if (count < 1) throw invalidRow("eligibility participant count");
    const signatures = signaturesByEvent.get(eventId) ?? [];
    signatures.push({ tagIds, count });
    signaturesByEvent.set(eventId, signatures);
  }

  const result = new Map<string, DashboardQuotaSummaryRead>();
  for (const [eventId, quotas] of quotasByEvent) {
    const participants: Array<{ user_id: string; class_ids: readonly string[] }> = [];
    for (const [signatureIndex, signature] of (signaturesByEvent.get(eventId) ?? []).entries()) {
      for (let index = 0; index < signature.count; index += 1) {
        participants.push({ user_id: `${signatureIndex}:${index}`, class_ids: signature.tagIds });
      }
    }
    if (participants.length > LIMITS.content.eventParticipantsPerEvent.max) {
      throw invalidRow("eligibility participant count");
    }
    const summary = summariseClassQuotas(
      quotas.map((quota) => ({ key: quota.tag_id, class_ids: [quota.tag_id], required: quota.required })),
      participants,
    );
    result.set(eventId, {
      slots: summary.slots.map((slot) => ({
        tagId: slot.key,
        required: slot.required,
        matched: slot.matched,
        dedicated: slot.dedicated,
        eligible: slot.eligible,
        floor: slot.floor,
        ceiling: slot.ceiling,
        status: slot.status,
      })),
      benchedCount: summary.benched.length,
      unassignedCount: summary.unassigned.length,
      flexible: summary.flexible,
      requiredTotal: summary.requiredTotal,
      matchedTotal: summary.matchedTotal,
      shortfall: summary.shortfall,
    });
  }
  return result;
}

function warRecord(row: readonly SqlValue[]): GuildWarRecord {
  const result = text(row[4], "war result");
  if (!(WAR_RESULTS as readonly string[]).includes(result)) throw invalidRow("war result");
  return {
    id: text(row[0], "war id"),
    eventId: nullableText(row[1], "war event id"),
    status: "concluded",
    warName: text(row[2], "war name"),
    enemyName: nullableText(row[3], "war enemy"),
    result: result as WarResult,
    ownStats: teamStats(row.slice(5, 10)),
    enemyStats: teamStats(row.slice(10, 15)),
    durationMinutes: nullableNumber(row[15], "war duration"),
    notes: nullableText(row[16], "war notes"),
    createdBy: text(row[17], "war creator"),
    updatedBy: nullableText(row[18], "war updater"),
    createdAt: text(row[19], "war created at"),
    updatedAt: text(row[20], "war updated at"),
    rosterVersion: integer(row[21], "war roster version"),
    concludedAt: text(row[22], "war concluded at"),
  };
}

function teamStats(values: readonly SqlValue[]): TeamStats | null {
  const parsed = values.map((value, index) => nullableNumber(value, `team stat ${index}`));
  if (parsed.every((value) => value === null)) return null;
  return {
    kills: parsed[0] ?? null,
    towers: parsed[1] ?? null,
    base_hp: parsed[2] ?? null,
    credits: parsed[3] ?? null,
    distance: parsed[4] ?? null,
  };
}

function mvps(members: readonly Readonly<{ name: string; stats: MemberStats }>[]) {
  if (members.length === 0) return null;
  const result = WAR_MVP_STAT_KEYS.flatMap((category) => {
    const candidates = members.flatMap((member) => {
      const value = member.stats[category];
      return value === null || value === undefined ? [] : [{ member, value }];
    });
    if (candidates.length === 0) return [];
    let best = candidates[0]!;
    const lowerIsBetter = (LOWER_IS_BETTER_WAR_STAT_KEYS as readonly WarMemberStatKey[]).includes(category);
    for (const candidate of candidates.slice(1)) {
      if (lowerIsBetter ? candidate.value < best.value : candidate.value > best.value) best = candidate;
    }
    return [{
      category,
      label: category,
      name: best.member.name,
      initials: Array.from(best.member.name).slice(0, 2).join("").toUpperCase(),
      value: best.value,
    }];
  });
  return result.length === 0 ? null : result;
}

function stringListMap(input: readonly (readonly SqlValue[])[], label: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of input) {
    const key = text(row[0], `${label} key`);
    const list = result.get(key) ?? [];
    list.push(text(row[1], `${label} value`));
    result.set(key, list);
  }
  return result;
}

function rows(result: SqlResult | undefined, label: string): readonly (readonly SqlValue[])[] {
  if (!result || result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) throw invalidRow(label);
  return result.rows as readonly (readonly SqlValue[])[];
}

function singleRow(result: SqlResult | undefined, label: string): readonly SqlValue[] | undefined {
  if (!result || result.rows === undefined) return undefined;
  if (!Array.isArray(result.rows) || result.rows.some((value) => Array.isArray(value))) throw invalidRow(label);
  return result.rows as readonly SqlValue[];
}

function boundedRows(result: SqlResult | undefined, limit: number, label: string) {
  const value = rows(result, label);
  if (value.length > limit) throw new AppError({ code: "SERVER_ERROR", status: 500, message: `${label} exceeded its hard limit` });
  return value;
}

function text(value: SqlValue | undefined, label: string): string {
  if (typeof value !== "string") throw invalidRow(label);
  return value;
}

function nullableText(value: SqlValue | undefined, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function stringArrayJson(value: SqlValue | undefined, label: string): string[] {
  if (typeof value !== "string") throw invalidRow(label);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) throw invalidRow(label);
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidRow(label);
  }
}

function integer(value: SqlValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalidRow(label);
  return value;
}

function integerOrZero(value: SqlValue | undefined): number {
  if (value === null || value === undefined) return 0;
  return integer(value, "integer aggregate");
}

function nullableInteger(value: SqlValue | undefined, label: string): number | null {
  if (value === null) return null;
  return integer(value, label);
}

function nonnegativeNumber(value: SqlValue | undefined, label: string): number {
  if (typeof value !== "number" || value < 0) throw invalidRow(label);
  return value;
}

function nullableNumber(value: SqlValue | undefined, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number") throw invalidRow(label);
  return value;
}

function boolean(value: SqlValue | undefined, label: string): boolean {
  if (value !== 0 && value !== 1) throw invalidRow(label);
  return value === 1;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function invalidRow(label: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message: `SQLite returned an invalid ${label} projection` });
}
