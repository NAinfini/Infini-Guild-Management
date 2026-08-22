import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql as dsql,
  type SQL,
} from "drizzle-orm";
import type {
  AnalyticsRead,
  GuildWarAggregate,
  GuildWarRecord,
  GuildWarStore,
  HistoryListQuery,
  MemberStats,
  TeamStats,
  WarMemberRecord,
} from "@guild/server/modules/guild-war";
import type { PaginatedResponse } from "@guild/shared";
import type { WarResult } from "@guild/shared/constants/guild-war";
import type { AppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlValue } from "@guild/kernel";
import { users } from "../schema/auth.js";
import { guildWars, warMembers, warTeams } from "../schema/guild-war.js";
import { mediaLinks } from "../schema/media.js";
import { auditInsertSelectStatement, auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount, returnedRows } from "./sql-result.js";

type GuildWarSchema = {
  guildWars: typeof guildWars;
  warTeams: typeof warTeams;
  warMembers: typeof warMembers;
  users: typeof users;
  mediaLinks: typeof mediaLinks;
};

const WAR_FIELDS = {
  id: guildWars.id,
  eventId: guildWars.eventId,
  status: guildWars.status,
  warName: guildWars.warName,
  enemyName: guildWars.enemyName,
  result: guildWars.result,
  ownKills: guildWars.ownKills,
  ownTowers: guildWars.ownTowers,
  ownBaseHp: guildWars.ownBaseHp,
  ownCredits: guildWars.ownCredits,
  ownDistance: guildWars.ownDistance,
  enemyKills: guildWars.enemyKills,
  enemyTowers: guildWars.enemyTowers,
  enemyBaseHp: guildWars.enemyBaseHp,
  enemyCredits: guildWars.enemyCredits,
  enemyDistance: guildWars.enemyDistance,
  durationMinutes: guildWars.durationMinutes,
  notes: guildWars.notes,
  rosterVersion: guildWars.rosterVersion,
  mutationToken: guildWars.mutationToken,
  concludedAt: guildWars.concludedAt,
  createdBy: guildWars.createdBy,
  updatedBy: guildWars.updatedBy,
  createdAt: guildWars.createdAt,
  updatedAt: guildWars.updatedAt,
};

/* 谁还能站上进行中的公会战名册：停用或已软删除的账号登不进来，也就打不了仗，
   把位置排给他们等于空一个坑。名册和候补池共用这一条判据，避免两边各判各的。 */
const ROSTER_ELIGIBLE = and(eq(users.isActive, true), isNull(users.deletedAt))!;

const MEMBER_FIELDS = {
  id: warMembers.id,
  warId: warMembers.warId,
  teamId: warMembers.teamId,
  userId: warMembers.userId,
  username: users.username,
  avatarMediaId: mediaLinks.mediaId,
  roleTag: warMembers.roleTag,
  sortOrder: warMembers.sortOrder,
  kills: warMembers.kills,
  deaths: warMembers.deaths,
  assists: warMembers.assists,
  damage: warMembers.damage,
  healing: warMembers.healing,
  buildingDamage: warMembers.buildingDamage,
  credits: warMembers.credits,
  damageTaken: warMembers.damageTaken,
  note: warMembers.note,
};

type WarRow = typeof guildWars.$inferSelect;
type MemberJoinedRow = {
  id: string;
  warId: string;
  teamId: string | null;
  userId: string;
  username: string;
  avatarMediaId: string | null;
  roleTag: string | null;
  sortOrder: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  healing: number | null;
  buildingDamage: number | null;
  credits: number | null;
  damageTaken: number | null;
  note: string | null;
};

export class SqliteGuildWarStore implements GuildWarStore {
  constructor(
    private readonly db: AppDatabase<GuildWarSchema>,
    private readonly sql: SqlExecutor,
  ) {}

  async getByEvent(eventId: string): Promise<GuildWarAggregate | null> {
    const row = (await this.db.select(WAR_FIELDS).from(guildWars).where(eq(guildWars.eventId, eventId)).limit(1))[0];
    return row ? (await this.hydrate([row]))[0]! : null;
  }

  async listRosterEligible(userIds: readonly string[]): Promise<readonly string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...userIds]), ROSTER_ELIGIBLE));
    return rows.map(({ id }) => id);
  }

  async getById(warId: string): Promise<GuildWarAggregate | null> {
    const row = (await this.db.select(WAR_FIELDS).from(guildWars).where(eq(guildWars.id, warId)).limit(1))[0];
    return row ? (await this.hydrate([row]))[0]! : null;
  }

  async getMany(warIds: readonly string[]): Promise<readonly GuildWarAggregate[]> {
    if (warIds.length === 0) return [];
    const rows = await this.db.select(WAR_FIELDS).from(guildWars).where(inArray(guildWars.id, [...warIds]));
    const hydrated = await this.hydrate(rows);
    const byId = new Map(hydrated.map((aggregate) => [aggregate.war.id, aggregate]));
    return warIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async getHistoryMany(warIds: readonly string[]): Promise<readonly GuildWarAggregate[]> {
    if (warIds.length === 0) return [];
    const rows = await this.db
      .select(WAR_FIELDS)
      .from(guildWars)
      .where(and(inArray(guildWars.id, [...warIds]), eq(guildWars.status, "concluded")));
    const hydrated = await this.hydrate(rows);
    const byId = new Map(hydrated.map((aggregate) => [aggregate.war.id, aggregate]));
    return warIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async listHistory(query: HistoryListQuery): Promise<PaginatedResponse<GuildWarRecord>> {
    const where = historyWhere(query);
    const [rows, countRows] = await Promise.all([
      this.db
        .select(WAR_FIELDS)
        .from(guildWars)
        .where(and(...where))
        .orderBy(desc(guildWars.createdAt), desc(guildWars.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ count: dsql<number>`count(*)` }).from(guildWars).where(and(...where)),
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    return {
      data: rows.map(toWarRecord),
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async concludedEventIds(): Promise<readonly string[]> {
    const rows = await this.db
      .select({ eventId: guildWars.eventId })
      .from(guildWars)
      .where(and(eq(guildWars.status, "concluded"), isNotNull(guildWars.eventId)))
      .orderBy(desc(guildWars.createdAt), desc(guildWars.id))
      .limit(500);
    return rows.flatMap(({ eventId }) => eventId ? [eventId] : []);
  }

  async createActive(input: Parameters<GuildWarStore["createActive"]>[0]): Promise<boolean> {
    const guard = { sql: "SELECT 1 FROM guild_wars WHERE id = ?", params: [input.id] };
    const results = await this.sql.batch([{
      method: "all",
      columns: ["affected"],
      sql: `INSERT INTO guild_wars (
        id, event_id, status, war_name, roster_version, mutation_token, created_by, created_at, updated_at
      ) VALUES (?, ?, 'active', ?, 0, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
      RETURNING 1 AS affected`,
      params: [input.id, input.eventId, input.warName, input.audit.eventId, input.actorUserId, input.now, input.now],
    }, auditInsertStatement(input.audit, guard)]);
    return returnedRowCount(results[0]) === 1;
  }

  async replaceRoster(input: Parameters<GuildWarStore["replaceRoster"]>[0]): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    const guard = versionGuard(input.warId, nextVersion, "active", input.audit.eventId);
    const participantUserIds = [
      ...input.teams.flatMap((team) => team.members.map(({ userId }) => userId)),
      ...input.pool.map(({ userId }) => userId),
    ];
    const teams = JSON.stringify(input.teams.map((team) => ({
      id: team.id,
      teamName: team.teamName,
      sortOrder: team.sortOrder,
      notes: team.notes,
      isLocked: team.isLocked,
    })));
    const members = JSON.stringify([
      ...input.teams.flatMap((team) => team.members.map((member) => ({
        id: member.id,
        teamId: team.id,
        userId: member.userId,
        roleTag: member.roleTag,
        sortOrder: member.sortOrder,
      }))),
      ...input.pool.map((member) => ({
        id: member.id,
        teamId: null,
        userId: member.userId,
        roleTag: null,
        sortOrder: member.sortOrder,
      })),
    ]);
    const statements: SqlBatchStatement[] = [versionUpdate(
      input.warId,
      input.expectedVersion,
      input.actorUserId,
      input.now,
      "active",
      input.audit.eventId,
      { eventId: input.eventId, userIds: participantUserIds },
    ), {
      method: "run",
      sql: `DELETE FROM war_members WHERE war_id = ? AND EXISTS (${guard.sql})`,
      params: [input.warId, ...guard.params],
    }, {
      method: "run",
      sql: `DELETE FROM war_teams WHERE war_id = ? AND EXISTS (${guard.sql})`,
      params: [input.warId, ...guard.params],
    }, {
      method: "run",
      sql: `INSERT INTO war_teams (id, war_id, team_name, sort_order, notes, is_locked)
        SELECT
          CAST(json_extract(value, '$.id') AS TEXT),
          ?,
          CAST(json_extract(value, '$.teamName') AS TEXT),
          CAST(json_extract(value, '$.sortOrder') AS INTEGER),
          json_extract(value, '$.notes'),
          CAST(json_extract(value, '$.isLocked') AS INTEGER)
        FROM json_each(?)
        WHERE EXISTS (${guard.sql})`,
      params: [input.warId, teams, ...guard.params],
    }, {
      method: "run",
      sql: `INSERT INTO war_members (id, war_id, team_id, user_id, role_tag, sort_order)
        SELECT
          CAST(json_extract(value, '$.id') AS TEXT),
          ?,
          CAST(json_extract(value, '$.teamId') AS TEXT),
          CAST(json_extract(value, '$.userId') AS TEXT),
          CAST(json_extract(value, '$.roleTag') AS TEXT),
          CAST(json_extract(value, '$.sortOrder') AS INTEGER)
        FROM json_each(?)
        WHERE EXISTS (${guard.sql})`,
      params: [input.warId, members, ...guard.params],
    }];
    statements.push(auditInsertStatement(input.audit, guard));
    const results = await this.sql.batch(statements);
    return returnedRowCount(results[0]) === 1;
  }

  async setRoleTags(input: Parameters<GuildWarStore["setRoleTags"]>[0]): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    const guard = versionGuard(input.warId, nextVersion, "active", input.audit.eventId);
    const updates = JSON.stringify(input.updates);
    const statements: SqlBatchStatement[] = [versionUpdate(
      input.warId,
      input.expectedVersion,
      input.actorUserId,
      input.now,
      "active",
      input.audit.eventId,
    ), {
      method: "run",
      sql: `WITH requested AS (
          SELECT
            CAST(json_extract(value, '$.userId') AS TEXT) AS user_id,
            CAST(json_extract(value, '$.roleTag') AS TEXT) AS role_tag,
            ROW_NUMBER() OVER (
              PARTITION BY CAST(json_extract(value, '$.userId') AS TEXT)
              ORDER BY CAST(key AS INTEGER) DESC
            ) AS recency
          FROM json_each(?)
        )
        UPDATE war_members AS member
        SET role_tag = (
          SELECT role_tag FROM requested
          WHERE requested.user_id = member.user_id AND requested.recency = 1
        )
        WHERE member.war_id = ?
          AND member.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM requested
            WHERE requested.user_id = member.user_id AND requested.recency = 1
          )
          AND EXISTS (${guard.sql})`,
      params: [updates, input.warId, ...guard.params],
    }];
    statements.push(auditInsertStatement(input.audit, guard));
    const results = await this.sql.batch(statements);
    return returnedRowCount(results[0]) === 1;
  }

  async conclude(input: Parameters<GuildWarStore["conclude"]>[0]): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    const guard = versionGuard(input.warId, nextVersion, "concluded", input.audit.eventId);
    const own = teamColumns(input.ownStats);
    const enemy = teamColumns(input.enemyStats);
    const memberStats = JSON.stringify(input.memberStats.map((member) => ({
      userId: member.userId,
      ...memberColumns(member.stats),
    })));
    const statements: SqlBatchStatement[] = [{
      method: "all",
      columns: ["affected"],
      sql: `UPDATE guild_wars SET
        status = 'concluded', enemy_name = ?, result = ?,
        own_kills = ?, own_towers = ?, own_base_hp = ?, own_credits = ?, own_distance = ?,
        enemy_kills = ?, enemy_towers = ?, enemy_base_hp = ?, enemy_credits = ?, enemy_distance = ?,
        duration_minutes = ?, concluded_at = ?, updated_by = ?, updated_at = ?, roster_version = ?, mutation_token = ?
        WHERE id = ? AND status = 'active' AND roster_version = ?
        RETURNING 1 AS affected`,
      params: [
        input.enemyName, input.result,
        own.kills, own.towers, own.baseHp, own.credits, own.distance,
        enemy.kills, enemy.towers, enemy.baseHp, enemy.credits, enemy.distance,
        input.durationMinutes, input.now, input.actorUserId, input.now, nextVersion, input.audit.eventId,
        input.warId, input.expectedVersion,
      ],
    }, {
      method: "run",
      sql: `WITH requested AS (
          SELECT
            CAST(json_extract(value, '$.userId') AS TEXT) AS user_id,
            json_extract(value, '$.kills') AS kills,
            json_extract(value, '$.deaths') AS deaths,
            json_extract(value, '$.assists') AS assists,
            json_extract(value, '$.damage') AS damage,
            json_extract(value, '$.healing') AS healing,
            json_extract(value, '$.buildingDamage') AS building_damage,
            json_extract(value, '$.credits') AS credits,
            json_extract(value, '$.damageTaken') AS damage_taken,
            ROW_NUMBER() OVER (
              PARTITION BY CAST(json_extract(value, '$.userId') AS TEXT)
              ORDER BY CAST(key AS INTEGER) DESC
            ) AS recency
          FROM json_each(?)
        )
        UPDATE war_members AS member SET
          kills = (SELECT kills FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          deaths = (SELECT deaths FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          assists = (SELECT assists FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          damage = (SELECT damage FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          healing = (SELECT healing FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          building_damage = (SELECT building_damage FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          credits = (SELECT credits FROM requested WHERE requested.user_id = member.user_id AND recency = 1),
          damage_taken = (SELECT damage_taken FROM requested WHERE requested.user_id = member.user_id AND recency = 1)
        WHERE member.war_id = ?
          AND member.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM requested
            WHERE requested.user_id = member.user_id AND recency = 1
          )
          AND EXISTS (${guard.sql})`,
      params: [memberStats, input.warId, ...guard.params],
    }];
    statements.push(auditInsertStatement(input.audit, guard));
    const results = await this.sql.batch(statements);
    return returnedRowCount(results[0]) === 1;
  }

  async createHistory(input: Parameters<GuildWarStore["createHistory"]>[0]): Promise<boolean> {
    const record = input.record;
    const own = teamColumns(record.ownStats);
    const enemy = teamColumns(record.enemyStats);
    const guard = { sql: "SELECT 1 FROM guild_wars WHERE id = ?", params: [record.id] };
    const results = await this.sql.batch([{
      method: "all",
      columns: ["affected"],
      sql: `INSERT INTO guild_wars (
        id, event_id, status, war_name, enemy_name, result,
        own_kills, own_towers, own_base_hp, own_credits, own_distance,
        enemy_kills, enemy_towers, enemy_base_hp, enemy_credits, enemy_distance,
        duration_minutes, notes, roster_version, mutation_token, concluded_at, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, 'concluded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
      RETURNING 1 AS affected`,
      params: [
        record.id, record.eventId, record.warName, record.enemyName, record.result,
        own.kills, own.towers, own.baseHp, own.credits, own.distance,
        enemy.kills, enemy.towers, enemy.baseHp, enemy.credits, enemy.distance,
        record.durationMinutes, record.notes, record.rosterVersion, input.audit.eventId, record.concludedAt,
        record.createdBy, record.updatedBy, record.createdAt, record.updatedAt,
      ],
    }, auditInsertStatement(input.audit, guard)]);
    return returnedRowCount(results[0]) === 1;
  }

  async updateHistory(input: Parameters<GuildWarStore["updateHistory"]>[0]): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    const sets: string[] = ["updated_by = ?", "updated_at = ?", "roster_version = ?", "mutation_token = ?"];
    const params: SqlValue[] = [input.actorUserId, input.now, nextVersion, input.audit.eventId];
    if (input.patch.eventId !== undefined) addSet(sets, params, "event_id", input.patch.eventId);
    if (input.patch.warName !== undefined) addSet(sets, params, "war_name", input.patch.warName);
    if (input.patch.enemyName !== undefined) addSet(sets, params, "enemy_name", input.patch.enemyName);
    if (input.patch.result !== undefined) addSet(sets, params, "result", input.patch.result);
    if (input.patch.durationMinutes !== undefined) addSet(sets, params, "duration_minutes", input.patch.durationMinutes);
    if (input.patch.notes !== undefined) addSet(sets, params, "notes", input.patch.notes);
    if (input.patch.ownStats !== undefined) addTeamSets("own", input.patch.ownStats, sets, params);
    if (input.patch.enemyStats !== undefined) addTeamSets("enemy", input.patch.enemyStats, sets, params);
    const guard = versionGuard(input.warId, nextVersion, "concluded", input.audit.eventId);
    params.push(input.warId, input.expectedVersion);
    const results = await this.sql.batch([{
      method: "all",
      columns: ["affected"],
      sql: `UPDATE guild_wars SET ${sets.join(", ")}
        WHERE id = ? AND status = 'concluded' AND roster_version = ?
        RETURNING 1 AS affected`,
      params,
    }, auditInsertStatement(input.audit, guard)]);
    return returnedRowCount(results[0]) === 1;
  }

  async deleteHistory(input: Parameters<GuildWarStore["deleteHistory"]>[0]): Promise<boolean> {
    const guard = versionGuard(input.warId, input.expectedVersion, "concluded", input.audit.eventId);
    const results = await this.sql.batch([
      mutationClaim(input.warId, input.expectedVersion, "concluded", input.audit.eventId),
      auditInsertStatement(input.audit, guard),
      {
        method: "all",
        columns: ["affected"],
        sql: `DELETE FROM guild_wars WHERE id = ? AND EXISTS (${guard.sql}) RETURNING 1 AS affected`,
        params: [input.warId, ...guard.params],
      },
    ]);
    return returnedRowCount(results[0]) === 1 && returnedRowCount(results[2]) === 1;
  }

  async deleteHistories(input: Parameters<GuildWarStore["deleteHistories"]>[0]): Promise<readonly string[]> {
    const requested = JSON.stringify(input.rows.map((row) => ({
      warId: row.warId,
      expectedVersion: row.expectedVersion,
      auditId: row.audit.eventId,
      audit: row.audit,
    })));
    const results = await this.sql.batch([{
      method: "all",
      columns: ["id"],
      sql: `UPDATE guild_wars
        SET mutation_token = (
          SELECT CAST(json_extract(value, '$.auditId') AS TEXT)
          FROM json_each(?) requested
          WHERE CAST(json_extract(value, '$.warId') AS TEXT) = guild_wars.id
        )
        WHERE status = 'concluded' AND EXISTS (
          SELECT 1 FROM json_each(?) requested
          WHERE CAST(json_extract(value, '$.warId') AS TEXT) = guild_wars.id
            AND CAST(json_extract(value, '$.expectedVersion') AS INTEGER) = guild_wars.roster_version
        )
        RETURNING id`,
      params: [requested, requested],
    }, auditInsertSelectStatement(
      `SELECT
        CAST(json_extract(requested.value, '$.audit.eventId') AS TEXT),
        CAST(json_extract(requested.value, '$.audit.requestId') AS TEXT),
        CAST(json_extract(requested.value, '$.audit.actorKind') AS TEXT),
        CAST(json_extract(requested.value, '$.audit.actorId') AS TEXT),
        CASE WHEN json_extract(requested.value, '$.audit.actorKind') = 'user'
          THEN (SELECT username FROM users
            WHERE id = CAST(json_extract(requested.value, '$.audit.actorId') AS TEXT))
          ELSE json_extract(requested.value, '$.audit.actorLabel') END,
        CAST(json_extract(requested.value, '$.audit.subjectType') AS TEXT),
        CAST(json_extract(requested.value, '$.audit.subjectId') AS TEXT),
        json_extract(requested.value, '$.audit.subjectLabel'),
        CAST(json_extract(requested.value, '$.audit.action') AS TEXT),
        json_extract(requested.value, '$.audit.payload'),
        CAST(json_extract(requested.value, '$.audit.occurredAt') AS TEXT)
      FROM json_each(?) requested
      WHERE EXISTS (
        SELECT 1 FROM guild_wars
        WHERE id = CAST(json_extract(requested.value, '$.warId') AS TEXT)
          AND status = 'concluded'
          AND roster_version = CAST(json_extract(requested.value, '$.expectedVersion') AS INTEGER)
          AND mutation_token = CAST(json_extract(requested.value, '$.auditId') AS TEXT)
      )`,
      [requested],
    ), {
      method: "all",
      columns: ["id"],
      sql: `DELETE FROM guild_wars
        WHERE status = 'concluded' AND EXISTS (
          SELECT 1 FROM json_each(?) requested
          WHERE CAST(json_extract(value, '$.warId') AS TEXT) = guild_wars.id
            AND CAST(json_extract(value, '$.expectedVersion') AS INTEGER) = guild_wars.roster_version
            AND CAST(json_extract(value, '$.auditId') AS TEXT) = guild_wars.mutation_token
        )
        RETURNING id`,
      params: [requested],
    }]);
    const deleted = new Set(returnedRows(results[2]).map(([id]) => id).filter((id): id is string => typeof id === "string"));
    return input.rows.flatMap((row) => deleted.has(row.warId) ? [row.warId] : []);
  }

  async updateMemberStats(input: Parameters<GuildWarStore["updateMemberStats"]>[0]): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    const guard = versionGuard(input.warId, nextVersion, "concluded", input.audit.eventId);
    const updates = JSON.stringify(input.updates.map((update) => ({
      userId: update.userId,
      hasStats: update.stats !== undefined,
      ...(update.stats === undefined ? {
        kills: null,
        deaths: null,
        assists: null,
        damage: null,
        healing: null,
        buildingDamage: null,
        credits: null,
        damageTaken: null,
      } : memberColumns(update.stats)),
      hasNote: update.note !== undefined,
      note: update.note ?? null,
    })));
    const statements: SqlBatchStatement[] = [versionUpdate(
      input.warId,
      input.expectedVersion,
      input.actorUserId,
      input.now,
      "concluded",
      input.audit.eventId,
    ), {
      method: "run",
      sql: `WITH requested AS (
          SELECT
            CAST(json_extract(value, '$.userId') AS TEXT) AS user_id,
            CAST(json_extract(value, '$.hasStats') AS INTEGER) AS has_stats,
            json_extract(value, '$.kills') AS kills,
            json_extract(value, '$.deaths') AS deaths,
            json_extract(value, '$.assists') AS assists,
            json_extract(value, '$.damage') AS damage,
            json_extract(value, '$.healing') AS healing,
            json_extract(value, '$.buildingDamage') AS building_damage,
            json_extract(value, '$.credits') AS credits,
            json_extract(value, '$.damageTaken') AS damage_taken,
            CAST(json_extract(value, '$.hasNote') AS INTEGER) AS has_note,
            json_extract(value, '$.note') AS note,
            CAST(key AS INTEGER) AS ordinal
          FROM json_each(?)
        )
        UPDATE war_members AS member SET
          kills = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT kills FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.kills END,
          deaths = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT deaths FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.deaths END,
          assists = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT assists FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.assists END,
          damage = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT damage FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.damage END,
          healing = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT healing FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.healing END,
          building_damage = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT building_damage FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.building_damage END,
          credits = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT credits FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.credits END,
          damage_taken = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_stats = 1
          ) THEN (
            SELECT damage_taken FROM requested
            WHERE requested.user_id = member.user_id AND has_stats = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.damage_taken END,
          note = CASE WHEN EXISTS (
            SELECT 1 FROM requested WHERE requested.user_id = member.user_id AND has_note = 1
          ) THEN (
            SELECT note FROM requested
            WHERE requested.user_id = member.user_id AND has_note = 1
            ORDER BY ordinal DESC LIMIT 1
          ) ELSE member.note END
        WHERE member.war_id = ?
          AND member.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM requested
            WHERE requested.user_id = member.user_id AND (has_stats = 1 OR has_note = 1)
          )
          AND EXISTS (${guard.sql})`,
      params: [updates, input.warId, ...guard.params],
    }];
    statements.push(auditInsertStatement(input.audit, guard));
    const results = await this.sql.batch(statements);
    return returnedRowCount(results[0]) === 1;
  }

  async readAnalytics(warIds: readonly string[], userIds: readonly string[]): Promise<AnalyticsRead> {
    const filters: SQL<unknown>[] = [eq(guildWars.status, "concluded")];
    if (warIds.length > 0) filters.push(
      dsql`${guildWars.id} IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(warIds)}))`,
    );
    const rows = await this.db
      .select(WAR_FIELDS)
      .from(guildWars)
      .where(and(...filters))
      .orderBy(desc(guildWars.createdAt), desc(guildWars.id))
      .limit(200);
    if (rows.length === 0) return { wars: [], teamSizes: new Map(), memberStats: [] };
    const ids = rows.map(({ id }) => id);
    const idsJson = JSON.stringify(ids);
    const selectedWars = dsql`${warMembers.warId} IN (SELECT CAST(value AS TEXT) FROM json_each(${idsJson}))`;
    const memberFilters: SQL<unknown>[] = [selectedWars, isNotNull(warMembers.teamId)];
    if (userIds.length > 0) memberFilters.push(
      dsql`${warMembers.userId} IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(userIds)}))`,
    );
    const [sizeRows, statsRows] = await Promise.all([
      this.db
        .select({ warId: warMembers.warId, count: dsql<number>`count(*)` })
        .from(warMembers)
        .where(and(selectedWars, isNotNull(warMembers.teamId)))
        .groupBy(warMembers.warId),
      this.db
        .select({
          userId: warMembers.userId,
          kills: dsql<number | null>`sum(${warMembers.kills})`,
          deaths: dsql<number | null>`sum(${warMembers.deaths})`,
          assists: dsql<number | null>`sum(${warMembers.assists})`,
          damage: dsql<number | null>`sum(${warMembers.damage})`,
          healing: dsql<number | null>`sum(${warMembers.healing})`,
          buildingDamage: dsql<number | null>`sum(${warMembers.buildingDamage})`,
          credits: dsql<number | null>`sum(${warMembers.credits})`,
          damageTaken: dsql<number | null>`sum(${warMembers.damageTaken})`,
        })
        .from(warMembers)
        .where(and(...memberFilters))
        .groupBy(warMembers.userId),
    ]);
    return {
      wars: rows.map(toWarRecord),
      teamSizes: new Map(sizeRows.map(({ warId, count }) => [warId, Number(count)])),
      memberStats: statsRows.map((row) => ({ userId: row.userId, stats: memberStatsFromRow(row) ?? {} })),
    };
  }

  async exportHistory(filters: Parameters<GuildWarStore["exportHistory"]>[0]): Promise<readonly GuildWarRecord[]> {
    const where: SQL<unknown>[] = [eq(guildWars.status, "concluded")];
    if (filters.eventId) where.push(eq(guildWars.eventId, filters.eventId));
    if (filters.dateFrom) where.push(gte(guildWars.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(guildWars.createdAt, filters.dateTo));
    const rows = await this.db
      .select(WAR_FIELDS)
      .from(guildWars)
      .where(and(...where))
      .orderBy(desc(guildWars.createdAt), desc(guildWars.id))
      .limit(10_000);
    return rows.map(toWarRecord);
  }

  private async hydrate(rows: readonly WarRow[]): Promise<GuildWarAggregate[]> {
    if (rows.length === 0) return [];
    const warIds = rows.map(({ id }) => id);
    /* 已结算的场次是战绩记录：谁上过场就是谁上过场，之后被停用不能倒回去把人从
       历史里抹掉，否则名册人数会和这场战的队伍规模、逐人战绩对不上。 */
    const concludedWarIds = rows.filter(({ status }) => status === "concluded").map(({ id }) => id);
    const memberVisibility = concludedWarIds.length === 0
      ? ROSTER_ELIGIBLE
      : or(inArray(warMembers.warId, concludedWarIds), ROSTER_ELIGIBLE);
    const [teams, members] = await Promise.all([
      this.db
        .select({
          id: warTeams.id,
          warId: warTeams.warId,
          teamName: warTeams.teamName,
          sortOrder: warTeams.sortOrder,
          notes: warTeams.notes,
          isLocked: warTeams.isLocked,
        })
        .from(warTeams)
        .where(inArray(warTeams.warId, warIds))
        .orderBy(asc(warTeams.warId), asc(warTeams.sortOrder), asc(warTeams.id)),
      this.db
        .select(MEMBER_FIELDS)
        .from(warMembers)
        .innerJoin(users, eq(users.id, warMembers.userId))
        .leftJoin(mediaLinks, and(
          eq(mediaLinks.entityType, "member_profile"),
          eq(mediaLinks.entityId, warMembers.userId),
          eq(mediaLinks.slot, "avatar"),
          eq(mediaLinks.audience, "public"),
        ))
        .where(and(inArray(warMembers.warId, warIds), memberVisibility))
        .orderBy(asc(warMembers.warId), asc(warMembers.teamId), asc(warMembers.sortOrder), asc(warMembers.id)),
    ]);
    const memberRecords = members.map((row) => toMemberRecord(row as MemberJoinedRow));
    const membersByTeam = new Map<string, WarMemberRecord[]>();
    const poolByWar = new Map<string, WarMemberRecord[]>();
    for (const member of memberRecords) {
      if (member.teamId === null) {
        const pool = poolByWar.get(member.warId) ?? [];
        pool.push(member);
        poolByWar.set(member.warId, pool);
      } else {
        const teamMembers = membersByTeam.get(member.teamId) ?? [];
        teamMembers.push(member);
        membersByTeam.set(member.teamId, teamMembers);
      }
    }
    const teamsByWar = new Map<string, GuildWarAggregate["teams"][number][]>();
    for (const team of teams) {
      const record = {
        id: team.id,
        warId: team.warId,
        teamName: team.teamName,
        sortOrder: team.sortOrder,
        notes: team.notes,
        isLocked: team.isLocked,
        members: membersByTeam.get(team.id) ?? [],
      };
      const warTeamRecords = teamsByWar.get(team.warId) ?? [];
      warTeamRecords.push(record);
      teamsByWar.set(team.warId, warTeamRecords);
    }
    return rows.map((row) => ({
      war: toWarRecord(row),
      teams: teamsByWar.get(row.id) ?? [],
      pool: poolByWar.get(row.id) ?? [],
    }));
  }
}

function historyWhere(query: HistoryListQuery): SQL<unknown>[] {
  const where: SQL<unknown>[] = [eq(guildWars.status, "concluded")];
  if (query.dateFrom) where.push(gte(guildWars.createdAt, query.dateFrom));
  if (query.dateTo) where.push(lte(guildWars.createdAt, query.dateTo));
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    where.push(or(
      dsql`${guildWars.warName} LIKE ${pattern} ESCAPE '\\'`,
      dsql`${guildWars.enemyName} LIKE ${pattern} ESCAPE '\\'`,
      dsql`${guildWars.result} LIKE ${pattern} ESCAPE '\\'`,
      dsql`${guildWars.createdAt} LIKE ${pattern} ESCAPE '\\'`,
    )!);
  }
  return where;
}

function toWarRecord(row: WarRow): GuildWarRecord {
  return {
    id: row.id,
    eventId: row.eventId,
    status: row.status,
    warName: row.warName,
    enemyName: row.enemyName,
    result: row.result as WarResult | null,
    ownStats: teamStatsFromRow(row, "own"),
    enemyStats: teamStatsFromRow(row, "enemy"),
    durationMinutes: row.durationMinutes,
    notes: row.notes,
    rosterVersion: row.rosterVersion,
    concludedAt: row.concludedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMemberRecord(row: MemberJoinedRow): WarMemberRecord {
  return {
    id: row.id,
    warId: row.warId,
    teamId: row.teamId,
    userId: row.userId,
    username: row.username,
    avatarMediaId: row.avatarMediaId,
    roleTag: row.roleTag,
    sortOrder: row.sortOrder,
    stats: memberStatsFromRow(row),
    note: row.note,
  };
}

function teamStatsFromRow(row: WarRow, side: "own" | "enemy"): TeamStats | null {
  return side === "own" ? recordedStats({
    kills: row.ownKills,
    towers: row.ownTowers,
    base_hp: row.ownBaseHp,
    credits: row.ownCredits,
    distance: row.ownDistance,
  }) : recordedStats({
    kills: row.enemyKills,
    towers: row.enemyTowers,
    base_hp: row.enemyBaseHp,
    credits: row.enemyCredits,
    distance: row.enemyDistance,
  });
}

function memberStatsFromRow(row: {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  healing: number | null;
  buildingDamage: number | null;
  credits: number | null;
  damageTaken: number | null;
}): MemberStats | null {
  return recordedStats({
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    damage: row.damage,
    healing: row.healing,
    building_damage: row.buildingDamage,
    credits: row.credits,
    damage_taken: row.damageTaken,
  });
}

function recordedStats<T extends Record<string, number | null>>(stats: T): T | null {
  const recorded = Object.entries(stats).filter(([, value]) => value !== null);
  return recorded.length > 0 ? Object.fromEntries(recorded) as T : null;
}

export function versionUpdate(
  warId: string,
  expectedVersion: number,
  actorUserId: string,
  now: string,
  status: "active" | "concluded",
  mutationToken: string,
  participants?: Readonly<{ eventId: string; userIds: readonly string[] }>,
): SqlBatchStatement {
  const participantGuard = participants
    ? ` AND event_id = ? AND NOT EXISTS (
      SELECT 1 FROM json_each(?) requested
      WHERE NOT EXISTS (
        SELECT 1 FROM event_participants participant
        WHERE participant.event_id = ?
          AND participant.user_id = CAST(requested.value AS TEXT)
      )
    )`
    : "";
  return {
    method: "all",
    columns: ["affected"],
    sql: `UPDATE guild_wars SET roster_version = roster_version + 1, mutation_token = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND status = ? AND roster_version = ?${participantGuard}
      RETURNING 1 AS affected`,
    params: [
      mutationToken, actorUserId, now, warId, status, expectedVersion,
      ...(participants ? [participants.eventId, JSON.stringify([...new Set(participants.userIds)]), participants.eventId] : []),
    ],
  };
}

function mutationClaim(
  warId: string,
  version: number,
  status: "active" | "concluded",
  mutationToken: string,
): SqlBatchStatement {
  return {
    method: "all",
    columns: ["affected"],
    sql: "UPDATE guild_wars SET mutation_token = ? WHERE id = ? AND status = ? AND roster_version = ? RETURNING 1 AS affected",
    params: [mutationToken, warId, status, version],
  };
}

export function versionGuard(warId: string, version: number, status: "active" | "concluded", mutationToken: string) {
  return {
    sql: "SELECT 1 FROM guild_wars WHERE id = ? AND status = ? AND roster_version = ? AND mutation_token = ?",
    params: [warId, status, version, mutationToken] as const,
  };
}

function teamColumns(stats: TeamStats | null) {
  return {
    kills: stats?.kills ?? null,
    towers: stats?.towers ?? null,
    baseHp: stats?.base_hp ?? null,
    credits: stats?.credits ?? null,
    distance: stats?.distance ?? null,
  };
}

function memberColumns(stats: MemberStats) {
  return {
    kills: stats.kills ?? null,
    deaths: stats.deaths ?? null,
    assists: stats.assists ?? null,
    damage: stats.damage ?? null,
    healing: stats.healing ?? null,
    buildingDamage: stats.building_damage ?? null,
    credits: stats.credits ?? null,
    damageTaken: stats.damage_taken ?? null,
  };
}

function addTeamSets(
  side: "own" | "enemy",
  stats: TeamStats | null,
  sets: string[],
  params: SqlValue[],
): void {
  const columns = teamColumns(stats);
  addSet(sets, params, `${side}_kills`, columns.kills);
  addSet(sets, params, `${side}_towers`, columns.towers);
  addSet(sets, params, `${side}_base_hp`, columns.baseHp);
  addSet(sets, params, `${side}_credits`, columns.credits);
  addSet(sets, params, `${side}_distance`, columns.distance);
}

function addSet(sets: string[], params: SqlValue[], column: string, value: SqlValue): void {
  sets.push(`${column} = ?`);
  params.push(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
