import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SQL_BATCH_STATEMENTS,
  assertSqlBatch,
  createAuthorizationContext,
  createRequestContext,
} from "@guild/kernel";
import { createAuditMutation } from "@guild/server/modules/audit";
import { MAX_GUILD_WAR_MEMBERS } from "@guild/shared";
import { createAppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlRow, SqlStatement } from "@guild/kernel";
import { SqliteGuildWarStore } from "./guild-war-store.js";
import { SqliteEventGuildWarLifecycleStore } from "./event-guild-war-lifecycle-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const databases: DatabaseSync[] = [];

const BASE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
  CREATE TABLE events (id TEXT PRIMARY KEY);
  CREATE TABLE event_participants (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    UNIQUE(event_id, user_id)
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, actor_username TEXT,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    summary TEXT, detail_json TEXT, occurred_at TEXT NOT NULL
  );
  CREATE TABLE guild_wars (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'concluded')),
    war_name TEXT NOT NULL,
    enemy_name TEXT,
    result TEXT CHECK(result IS NULL OR result IN ('win', 'loss', 'draw')),
    own_kills REAL, own_towers REAL, own_base_hp REAL, own_credits REAL, own_distance REAL,
    enemy_kills REAL, enemy_towers REAL, enemy_base_hp REAL, enemy_credits REAL, enemy_distance REAL,
    duration_minutes REAL, notes TEXT,
    roster_version INTEGER NOT NULL DEFAULT 0,
    mutation_token TEXT,
    concluded_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id)
  );
  CREATE UNIQUE INDEX ux_guild_wars_event ON guild_wars(event_id);
  CREATE UNIQUE INDEX ux_guild_wars_mutation_token ON guild_wars(mutation_token) WHERE mutation_token IS NOT NULL;
  CREATE INDEX idx_guild_wars_active_event ON guild_wars(status, event_id, id);
  CREATE INDEX idx_guild_wars_history_created ON guild_wars(status, created_at, id);
  CREATE TABLE war_teams (
    id TEXT PRIMARY KEY,
    war_id TEXT NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
    team_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    notes TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(war_id, id)
  );
  CREATE INDEX idx_war_teams_war_sort ON war_teams(war_id, sort_order, id);
  CREATE TABLE war_members (
    id TEXT PRIMARY KEY,
    war_id TEXT NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES war_teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_tag TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    kills REAL, deaths REAL, assists REAL, damage REAL, healing REAL,
    building_damage REAL, credits REAL, damage_taken REAL, note TEXT,
    UNIQUE(war_id, user_id)
  );
  CREATE INDEX idx_war_members_team_sort ON war_members(team_id, sort_order, id);
  CREATE INDEX idx_war_members_war_pool_sort ON war_members(war_id, team_id, sort_order, id);
  CREATE INDEX idx_war_members_user_war ON war_members(user_id, war_id);
`;

class TestSqlExecutor implements SqlExecutor {
  readonly statements: SqlStatement[] = [];
  readonly batches: SqlBatchStatement[][] = [];

  constructor(readonly database: DatabaseSync) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    this.statements.push(statement);
    return this.run(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    assertSqlBatch(statements);
    this.batches.push([...statements]);
    this.statements.push(...statements);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.run(statement));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private run(statement: SqlStatement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    const params = [...(statement.params ?? [])] as SQLInputValue[];
    if (statement.method === "run") {
      const result = prepared.run(...params);
      return { rows: [], lastInsertRowId: result.lastInsertRowid };
    }
    prepared.setReturnArrays(true);
    if (statement.method === "get") {
      return { rows: prepared.get(...params) as unknown as SqlRow | undefined };
    }
    return { rows: prepared.all(...params) as unknown as readonly SqlRow[] };
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(BASE_SCHEMA);
  database.exec(readFileSync(
    fileURLToPath(new URL("../schema/guild-war.invariants.sql", import.meta.url)),
    "utf8",
  ));
  const seedUsers: Array<[string, string]> = [["admin-1", "Admin"], ["user-1", "One"], ["user-2", "Two"]];
  for (const [id, username] of seedUsers) {
    database.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(id, username);
  }
  database.prepare("INSERT INTO events (id) VALUES ('event-1')").run();
  const executor = new TestSqlExecutor(database);
  return {
    database,
    executor,
    lifecycle: new SqliteEventGuildWarLifecycleStore(executor),
    store: new SqliteGuildWarStore(createAppDatabase(executor), executor),
  };
}

function context(requestId: string) {
  return createRequestContext({
    requestId,
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 1,
      permissions: ["guildwar.teams.edit"],
    }),
    now: NOW,
  });
}

function audit(
  requestId: string,
  action: "init" | "save_teams" | "move_member" | "set_role_tag" | "conclude" | "batch_update",
) {
  return createAuditMutation(context(requestId), {
    entityType: action === "conclude"
      ? "guild_war_history"
      : action === "batch_update"
        ? "guild_war_member_stats"
        : "guild_war",
    entityId: "war-1",
    action,
  });
}

function seedParticipants(database: DatabaseSync, count: number): string[] {
  const userInsert = database.prepare("INSERT INTO users (id, username) VALUES (?, ?)");
  const participantInsert = database.prepare(`INSERT INTO event_participants (id, event_id, user_id, joined_at)
    VALUES (?, 'event-1', ?, ?)`);
  return Array.from({ length: count }, (_, index) => {
    const userId = `bulk-user-${index}`;
    userInsert.run(userId, `Bulk ${index}`);
    participantInsert.run(`bulk-participant-${index}`, userId, NOW);
    return userId;
  });
}

async function seededRoster() {
  const value = harness();
  await value.store.createActive({
    id: "war-1",
    eventId: "event-1",
    warName: "War",
    actorUserId: "admin-1",
    now: NOW,
    audit: audit("request-init", "init"),
  });
  value.database.prepare(`INSERT INTO event_participants (id, event_id, user_id, joined_at)
    VALUES ('participant-1', 'event-1', 'user-1', ?), ('participant-2', 'event-1', 'user-2', ?)`)
    .run(NOW, NOW);
  await value.store.replaceRoster({
    warId: "war-1",
    eventId: "event-1",
    expectedVersion: 0,
    actorUserId: "admin-1",
    now: NOW,
    teams: [{
      id: "team-1",
      teamName: "Alpha",
      sortOrder: 0,
      notes: null,
      isLocked: false,
      members: [{ id: "member-1", userId: "user-1", roleTag: null, sortOrder: 0 }],
    }],
    pool: [{ id: "pool-2", userId: "user-2", sortOrder: 0 }],
    audit: audit("request-roster", "save_teams"),
  });
  return value;
}

describe("SqliteGuildWarStore concurrency", () => {
  it("keeps cross-domain participant DML out of SqliteGuildWarStore", () => {
    const source = readFileSync(fileURLToPath(new URL("./guild-war-store.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/DELETE\s+FROM\s+event_participants/i);
  });

  it("rejects a roster containing a non-participant without changing roster or audit state", async () => {
    const { database, store } = await seededRoster();
    const changed = await store.replaceRoster({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      teams: [{
        id: "team-other",
        teamName: "Invalid",
        sortOrder: 0,
        notes: null,
        isLocked: false,
        members: [{ id: "member-admin", userId: "admin-1", roleTag: null, sortOrder: 0 }],
      }],
      pool: [],
      audit: audit("request-invalid-roster", "save_teams"),
    });
    expect(changed).toBe(false);
    expect(scalar(database, "SELECT roster_version FROM guild_wars WHERE id = 'war-1'")).toBe(1);
    expect(text(database, "SELECT team_name FROM war_teams WHERE war_id = 'war-1'")).toBe("Alpha");
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE request_id = 'request-invalid-roster'")).toBe(0);
  });

  it("rolls back the CAS claim and roster deletes when a set insert fails", async () => {
    const { database, store } = await seededRoster();
    const mutationToken = text(database, "SELECT mutation_token FROM guild_wars WHERE id = 'war-1'");
    await expect(store.replaceRoster({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      teams: [{
        id: "duplicate-team",
        teamName: "First",
        sortOrder: 0,
        notes: null,
        isLocked: false,
        members: [{ id: "replacement-1", userId: "user-1", roleTag: null, sortOrder: 0 }],
      }, {
        id: "duplicate-team",
        teamName: "Second",
        sortOrder: 1,
        notes: null,
        isLocked: false,
        members: [{ id: "replacement-2", userId: "user-2", roleTag: null, sortOrder: 0 }],
      }],
      pool: [],
      audit: audit("request-failed-roster", "save_teams"),
    })).rejects.toThrow();
    expect(scalar(database, "SELECT roster_version FROM guild_wars WHERE id = 'war-1'")).toBe(1);
    expect(text(database, "SELECT mutation_token FROM guild_wars WHERE id = 'war-1'")).toBe(mutationToken);
    expect(text(database, "SELECT team_name FROM war_teams WHERE war_id = 'war-1'")).toBe("Alpha");
    expect(scalar(database, "SELECT count(*) FROM war_members WHERE war_id = 'war-1'")).toBe(2);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE request_id = 'request-failed-roster'")).toBe(0);
  });

  it("commits exactly one competing drag batch and its audit", async () => {
    const { database, lifecycle } = await seededRoster();
    const input = (requestId: string, to: string) => ({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      moves: [{ id: `move-${requestId}`, userId: "user-2", to, participantId: null }],
      audit: audit(requestId, "move_member"),
    });
    const candidates = [input("request-move-a", "team-1"), input("request-move-b", "pool")];
    const outcomes = await Promise.all(candidates.map((candidate) => lifecycle.moveMembers(candidate)));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const winner = candidates[outcomes.findIndex(Boolean)]!;
    expect(scalar(database, "SELECT roster_version FROM guild_wars WHERE id = 'war-1'")).toBe(2);
    expect(text(database, "SELECT mutation_token FROM guild_wars WHERE id = 'war-1'")).toBe(winner.audit.id);
    expect(text(database, "SELECT COALESCE(team_id, 'pool') FROM war_members WHERE war_id = 'war-1' AND user_id = 'user-2'"))
      .toBe(winner.moves[0]!.to);
    expect(text(database, "SELECT request_id FROM audit_log WHERE action = 'move_member'")).toBe(winner.audit.requestId);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE action = 'move_member'")).toBe(1);
  });

  it("atomically enrolls a new pool member before placing them in the roster", async () => {
    const { database, lifecycle } = await seededRoster();
    const changed = await lifecycle.moveMembers({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      moves: [{
        id: "new-pool-member",
        userId: "admin-1",
        to: "pool",
        participantId: "new-event-participant",
      }],
      audit: audit("request-enroll-and-move", "move_member"),
    });

    expect(changed).toBe(true);
    expect(scalar(database, `SELECT count(*) FROM event_participants
      WHERE event_id = 'event-1' AND user_id = 'admin-1'`)).toBe(1);
    expect(scalar(database, `SELECT count(*) FROM war_members
      WHERE war_id = 'war-1' AND user_id = 'admin-1' AND team_id IS NULL`)).toBe(1);
    expect(scalar(database, "SELECT roster_version FROM guild_wars WHERE id = 'war-1'")).toBe(2);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE request_id = 'request-enroll-and-move'")).toBe(1);
  });

  it("rolls back roster, participant, version, and audit when a joint move fails", async () => {
    const { database, lifecycle } = await seededRoster();
    const duplicateAudit = audit("request-move-rollback", "move_member");
    database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      duplicateAudit.id,
      duplicateAudit.requestId,
      duplicateAudit.actorUserId,
      duplicateAudit.entityType,
      duplicateAudit.entityId,
      duplicateAudit.action,
      duplicateAudit.occurredAt,
    );

    await expect(lifecycle.moveMembers({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      moves: [{ id: "removed-user-1", userId: "user-1", to: "remove", participantId: null }],
      audit: duplicateAudit,
    })).rejects.toThrow();
    expect(scalar(database, "SELECT roster_version FROM guild_wars WHERE id = 'war-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM war_members WHERE war_id = 'war-1' AND user_id = 'user-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM event_participants WHERE event_id = 'event-1' AND user_id = 'user-1'")).toBe(1);
  });

  it("guards active-war event deletion and rolls back the whole lifecycle batch on audit failure", async () => {
    const { database, lifecycle } = await seededRoster();
    const blockedAudit = audit("request-event-blocked", "move_member");
    await expect(lifecycle.destroyEvent({
      eventId: "event-1",
      allowActiveWarDelete: false,
      audit: blockedAudit,
    })).resolves.toBe("active_war_permission_required");
    expect(scalar(database, "SELECT count(*) FROM events WHERE id = 'event-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM guild_wars WHERE id = 'war-1'")).toBe(1);
    expect(database.prepare("SELECT count(*) AS value FROM audit_log WHERE id = ?").get(blockedAudit.id))
      .toMatchObject({ value: 0 });

    const duplicateAudit = audit("request-event-rollback", "move_member");
    database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      duplicateAudit.id,
      duplicateAudit.requestId,
      duplicateAudit.actorUserId,
      duplicateAudit.entityType,
      duplicateAudit.entityId,
      duplicateAudit.action,
      duplicateAudit.occurredAt,
    );
    await expect(lifecycle.destroyEvent({
      eventId: "event-1",
      allowActiveWarDelete: true,
      audit: duplicateAudit,
    })).rejects.toThrow();
    expect(scalar(database, "SELECT count(*) FROM events WHERE id = 'event-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM guild_wars WHERE id = 'war-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM war_teams WHERE war_id = 'war-1'")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM war_members WHERE war_id = 'war-1'")).toBe(2);

    await expect(lifecycle.destroyEvent({
      eventId: "event-1",
      allowActiveWarDelete: true,
      audit: audit("request-event-delete", "move_member"),
    })).resolves.toBe("deleted");
    expect(scalar(database, "SELECT count(*) FROM events WHERE id = 'event-1'")).toBe(0);
    expect(scalar(database, "SELECT count(*) FROM guild_wars WHERE id = 'war-1'")).toBe(0);
  });

  it("allows one conclude CAS, preserves the same aggregate, and aggregates fixed stats", async () => {
    const { database, store } = await seededRoster();
    const conclude = (requestId: string, result: "win" | "loss", kills: number) => ({
      warId: "war-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      enemyName: "Rivals",
      result,
      ownStats: { kills },
      enemyStats: { kills: 5 },
      durationMinutes: 30.5,
      memberStats: [{ userId: "user-1", stats: { kills, deaths: 1, assists: 3 } }],
      audit: audit(requestId, "conclude"),
    });
    const candidates = [conclude("request-conclude-a", "win", 2), conclude("request-conclude-b", "loss", 9)];
    const outcomes = await Promise.all(candidates.map((candidate) => store.conclude(candidate)));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const winner = candidates[outcomes.findIndex(Boolean)]!;
    const aggregate = await store.getByEvent("event-1");
    expect(aggregate?.war).toMatchObject({ id: "war-1", status: "concluded", result: winner.result });
    expect(aggregate?.teams[0]?.members[0]?.stats).toMatchObject({ kills: winner.memberStats[0]!.stats.kills, deaths: 1, assists: 3 });
    const analytics = await store.readAnalytics(["war-1"], []);
    expect(analytics.teamSizes.get("war-1")).toBe(1);
    expect(analytics.memberStats).toEqual([{ userId: "user-1", stats: { kills: winner.memberStats[0]!.stats.kills, deaths: 1, assists: 3 } }]);
    expect(text(database, "SELECT mutation_token FROM guild_wars WHERE id = 'war-1'")).toBe(winner.audit.id);
    expect(text(database, "SELECT request_id FROM audit_log WHERE action = 'conclude'")).toBe(winner.audit.requestId);
    expect(scalar(database, "SELECT count(*) FROM guild_wars")).toBe(1);
    expect(scalar(database, "SELECT count(*) FROM audit_log WHERE action = 'conclude'")).toBe(1);
  });
});

describe("SqliteGuildWarStore bounded member writes", () => {
  it("keeps every maximum legal member mutation below the batch ceiling", async () => {
    const { database, executor, lifecycle, store } = harness();
    const userIds = seedParticipants(database, MAX_GUILD_WAR_MEMBERS);
    await store.createActive({
      id: "war-1",
      eventId: "event-1",
      warName: "War",
      actorUserId: "admin-1",
      now: NOW,
      audit: audit("request-bulk-init", "init"),
    });

    expect(await store.replaceRoster({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 0,
      actorUserId: "admin-1",
      now: NOW,
      teams: [{
        id: "bulk-team",
        teamName: "Bulk",
        sortOrder: 0,
        notes: null,
        isLocked: false,
        members: userIds.slice(0, 50).map((userId, index) => ({
          id: `bulk-member-${index}`,
          userId,
          roleTag: null,
          sortOrder: index,
        })),
      }],
      pool: userIds.slice(50).map((userId, index) => ({
        id: `bulk-pool-${index}`,
        userId,
        sortOrder: index,
      })),
      audit: audit("request-bulk-roster", "save_teams"),
    })).toBe(true);

    expect(await lifecycle.moveMembers({
      warId: "war-1",
      eventId: "event-1",
      expectedVersion: 1,
      actorUserId: "admin-1",
      now: NOW,
      moves: userIds.map((userId, index) => ({
        id: `bulk-move-${index}`,
        userId,
        to: "bulk-team",
        participantId: null,
      })),
      audit: audit("request-bulk-move", "move_member"),
    })).toBe(true);
    expect(await store.setRoleTags({
      warId: "war-1",
      expectedVersion: 2,
      actorUserId: "admin-1",
      now: NOW,
      updates: userIds.map((userId) => ({ userId, roleTag: "raider" })),
      audit: audit("request-bulk-roles", "set_role_tag"),
    })).toBe(true);
    expect(await store.conclude({
      warId: "war-1",
      expectedVersion: 3,
      actorUserId: "admin-1",
      now: NOW,
      enemyName: "Rivals",
      result: "win",
      ownStats: { kills: 100 },
      enemyStats: { kills: 50 },
      durationMinutes: 30,
      memberStats: userIds.map((userId, index) => ({ userId, stats: { kills: index } })),
      audit: audit("request-bulk-conclude", "conclude"),
    })).toBe(true);
    expect(await store.updateMemberStats({
      warId: "war-1",
      expectedVersion: 4,
      actorUserId: "admin-1",
      now: NOW,
      updates: userIds.map((userId, index) => ({
        userId,
        stats: { kills: index + 10 },
        note: `note-${index}`,
      })),
      audit: audit("request-bulk-stats", "batch_update"),
    })).toBe(true);

    const memberBatchSizes = executor.batches.slice(1).map((batch) => batch.length);
    expect(memberBatchSizes).toEqual([6, 6, 3, 3, 3]);
    expect(Math.max(...memberBatchSizes)).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(scalar(database, "SELECT count(*) FROM war_members WHERE war_id = 'war-1' AND team_id = 'bulk-team'")).toBe(MAX_GUILD_WAR_MEMBERS);
    expect(scalar(database, "SELECT count(*) FROM war_members WHERE war_id = 'war-1' AND role_tag = 'raider'")).toBe(MAX_GUILD_WAR_MEMBERS);
    expect(scalar(database, "SELECT count(*) FROM war_members WHERE war_id = 'war-1' AND note LIKE 'note-%'")).toBe(MAX_GUILD_WAR_MEMBERS);
  });
});

describe("SqliteGuildWarStore query plans", () => {
  it("uses stable active/history and member aggregate indexes", () => {
    const { database } = harness();
    expect(plan(database, "SELECT id FROM guild_wars WHERE event_id = ? AND status = 'active'", "event-1"))
      .toMatch(/ux_guild_wars_event|idx_guild_wars_active_event/);
    expect(plan(database, "SELECT id FROM guild_wars WHERE status = 'concluded' ORDER BY created_at DESC, id DESC LIMIT 20"))
      .toContain("idx_guild_wars_history_created");
    expect(plan(database, "SELECT war_id, count(*) FROM war_members WHERE war_id = ? AND team_id IS NOT NULL GROUP BY war_id", "war-1"))
      .toContain("idx_war_members_war_pool_sort");
  });
});

describe("SqliteGuildWarStore analytics filters", () => {
  it("keeps the legal 20-war and 100-user request below D1's 100-parameter limit", async () => {
    const { database, executor, store } = harness();
    const warIds = Array.from({ length: 20 }, (_, index) => `history-${index}`);
    const insert = database.prepare(`INSERT INTO guild_wars (
      id, status, war_name, result, concluded_at, created_by, created_at, updated_at
    ) VALUES (?, 'concluded', ?, 'win', ?, 'admin-1', ?, ?)`);
    for (const warId of warIds) insert.run(warId, warId, NOW, NOW, NOW);
    const userIds = Array.from({ length: 100 }, (_, index) => `user-filter-${index}`);

    const analytics = await store.readAnalytics(warIds, userIds);

    expect(analytics.wars).toHaveLength(20);
    const analyticsStatements = executor.statements.filter((statement) => statement.sql.includes("json_each"));
    expect(analyticsStatements).toHaveLength(3);
    expect(Math.max(...analyticsStatements.map((statement) => statement.params?.length ?? 0))).toBeLessThan(100);
  });
});

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function text(database: DatabaseSync, sql: string): string | null {
  const row = database.prepare(sql).get() as Record<string, string | null>;
  return Object.values(row)[0] ?? null;
}

function plan(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): string {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map(({ detail }) => detail).join("\n");
}
