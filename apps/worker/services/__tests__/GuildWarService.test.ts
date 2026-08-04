import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import {
  GuildWarService,
  toWarHistoryPayload,
  toTeamPayload,
  toMemberPayload,
  buildWarEtag,
} from "../GuildWarService";
import { parseRecurrenceRule } from "../EventService";

const historyRow = {
  id: "war-1",
  eventId: "event-1",
  warName: "War 1",
  enemyName: "Enemy",
  result: null,
  ownStats: null,
  enemyStats: null,
  durationMinutes: null,
  notes: null,
  createdBy: "mod-1",
  updatedBy: null,
  createdAt: "2026-03-08T12:00:00.000Z",
  updatedAt: "2026-03-08T12:00:00.000Z",
};

function createConcludeService(batch: ReturnType<typeof vi.fn>) {
  const prepare = vi.fn((sql: string) => ({
    sql,
    bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
  }));
  const select = vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn().mockResolvedValue([{ title: "Siege Night" }]),
    };
    return builder;
  });
  const service = new GuildWarService({ select } as never, {
    media: { get: vi.fn() },
    writeAuditLog: vi.fn(),
    publishEntityChanged: vi.fn(),
    rawDb: { prepare, batch } as never,
  });
  vi.spyOn(service, "getTeamsForEvent").mockResolvedValue([
    {
      id: "team-1",
      warHistoryId: null,
      eventId: "event-1",
      teamName: "Alpha",
      sortOrder: 0,
      notes: null,
      isLocked: false,
    },
  ]);
  vi.spyOn(service, "getMembersForTeams").mockResolvedValue([
    {
      id: "member-1",
      warTeamId: "team-1",
      userId: "user-1",
      roleTag: null,
      sortOrder: 0,
      stats: null,
      note: null,
    },
  ]);
  return service;
}

describe("GuildWarService helpers", () => {
  it("preserves event-owned team ids, generates ids for new teams, and rejects foreign ids", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      sql,
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const service = new GuildWarService({} as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: { prepare, batch } as never,
    });
    vi.spyOn(service, "getTeamsForEvent").mockResolvedValue([
      {
        id: "team-owned",
        warHistoryId: null,
        eventId: "event-1",
        teamName: "Alpha",
        sortOrder: 0,
        notes: null,
        isLocked: false,
      },
    ]);

    const result = await service.replaceEventTeams("event-1", {
      teams: [
        {
          id: "team-owned",
          team_name: "Alpha Prime",
          sort_order: 0,
          members: [],
        },
        {
          team_name: "Bravo",
          sort_order: 1,
          members: [],
        },
      ],
      pool_members: [],
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    const statements = batch.mock.calls[0]?.[0] as Array<{ sql: string; bindings: unknown[] }>;
    const teamInserts = statements.filter((statement) => statement.sql.includes("INSERT INTO war_teams"));
    expect(teamInserts[0]?.bindings[0]).toBe("team-owned");
    expect(teamInserts[1]?.bindings[0]).toEqual(expect.any(String));
    expect(teamInserts[1]?.bindings[0]).not.toBe("team-owned");

    batch.mockClear();
    const rejected = await service.replaceEventTeams("event-1", {
      teams: [
        {
          id: "team-from-another-event",
          team_name: "Injected",
          sort_order: 0,
          members: [],
        },
      ],
      pool_members: [],
    });

    expect(rejected).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Team does not belong to this guild war event",
      details: { team_id: "team-from-another-event" },
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("toWarHistoryPayload maps camelCase to snake_case", () => {
    const payload = toWarHistoryPayload(historyRow);
    expect(payload).toEqual(
      expect.objectContaining({
        id: "war-1",
        event_id: "event-1",
        war_name: "War 1",
        enemy_name: "Enemy",
        created_by: "mod-1",
      }),
    );
  });

  it("toTeamPayload maps team row", () => {
    const payload = toTeamPayload({
      id: "team-1",
      warHistoryId: "war-1",
      eventId: null,
      teamName: "Alpha",
      sortOrder: 0,
      notes: null,
      isLocked: false,
    });
    expect(payload).toEqual(
      expect.objectContaining({
        id: "team-1",
        war_history_id: "war-1",
        team_name: "Alpha",
        sort_order: 0,
      }),
    );
  });

  it("toMemberPayload maps member row", () => {
    const payload = toMemberPayload({
      id: "member-1",
      warTeamId: "team-1",
      userId: "u-1",
      roleTag: "tank",
      sortOrder: 0,
      stats: { kills: 5, deaths: 2, assists: 3, damage: 1000, healing: 500, building_damage: 200, credits: 100, damage_taken: 800 },
      note: null,
    });
    expect(payload).toEqual(
      expect.objectContaining({
        id: "member-1",
        user_id: "u-1",
        role_tag: "tank",
        stats: expect.objectContaining({ kills: 5, deaths: 2 }),
      }),
    );
  });

  it("buildWarEtag produces deterministic etag", () => {
    const etag = buildWarEtag("war-1", "2026-03-08T12:00:00.000Z");
    expect(typeof etag).toBe("string");
    expect(etag).toBe(buildWarEtag("war-1", "2026-03-08T12:00:00.000Z"));
    expect(etag).not.toBe(buildWarEtag("war-2", "2026-03-08T12:00:00.000Z"));
  });

  it("returns D1 analytics settings even when there is no war history", async () => {
    const configuredSettings = {
      reference_duration_minutes: 45,
      modifier_weights: { kills: 0.8, towers: 0.2 },
    };
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { analyticsSettingsJson: JSON.stringify(configuredSettings) },
            ]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([]),
            })),
          })),
        })),
      });
    const service = new GuildWarService({ select } as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: {} as D1Database,
    });

    const result = await service.getAnalytics([], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.analytics_settings).toMatchObject(configuredSettings);
    }
  });

  it("filters history rows and totals with one escaped server-side search", async () => {
    const where = vi.fn()
      .mockReturnValueOnce({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            offset: vi.fn().mockResolvedValue([]),
          })),
        })),
      })
      .mockResolvedValueOnce([{ count: 0 }]);
    const service = new GuildWarService({
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where })),
      })),
    } as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: {} as D1Database,
    });

    await service.listHistory(1, 20, { search: "100%_win" });

    expect(where).toHaveBeenCalledTimes(2);
    const rowWhere = where.mock.calls[0]?.[0] as SQL;
    const countWhere = where.mock.calls[1]?.[0] as SQL;
    const dialect = new SQLiteSyncDialect();
    const rowQuery = dialect.sqlToQuery(rowWhere);
    const countQuery = dialect.sqlToQuery(countWhere);
    expect(rowQuery.sql).toContain("ESCAPE '\\'");
    expect(rowQuery.params).toContain("%100\\%\\_win%");
    expect(countQuery.sql).toBe(rowQuery.sql);
    expect(countQuery.params).toEqual(rowQuery.params);
  });

  it("parseRecurrenceRule handles null and json", () => {
    expect(parseRecurrenceRule(null)).toBeNull();
    expect(parseRecurrenceRule(undefined as unknown as string | null)).toBeNull();
    const rule = { freq: "weekly", interval: 1 };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
    expect(parseRecurrenceRule("not json")).toBeNull();
  });

  it("hides the active board when its event is not publicly visible yet", async () => {
    const futureEvent = {
      id: "event-1",
      type: "guild_war",
      title: "Hidden war",
      description: null,
      startAt: "2026-03-20T19:00:00.000Z",
      endAt: null,
      capacity: 20,
      pinned: false,
      signupLocked: false,
      autoArchive: false,
      autoArchived: false,
      visibleAt: "9999-12-31T23:59:59.999Z",
      archivedAt: null,
      createdBy: "mod-1",
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
      createdAt: "2026-03-08T12:00:00.000Z",
      updatedAt: "2026-03-08T12:00:00.000Z",
    };
    const select = vi.fn((fields: Record<string, unknown>) => {
      const rows = "visibleAt" in fields ? [futureEvent] : [];
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn().mockResolvedValue(rows),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    });
    const service = new GuildWarService({ select } as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: {} as D1Database,
    });
    vi.spyOn(service, "getTeamsForEvent").mockResolvedValue([]);
    vi.spyOn(service, "getMembersForTeams").mockResolvedValue([]);

    const result = await service.getActive("event-1", false);

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Guild war event not found",
    });

    const managerResult = await service.getActive("event-1", true);
    expect(managerResult).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        event: expect.objectContaining({ id: "event-1" }),
      }),
    }));
  });

  it("neutralizes spreadsheet formulas in guild-war CSV exports", async () => {
    const maliciousRow = {
      ...historyRow,
      warName: "=HYPERLINK(\"https://evil.example\",\"open\")",
    };
    const select = vi.fn((fields: Record<string, unknown>) => {
      if ("warName" in fields) {
        const limit = vi.fn().mockResolvedValue([maliciousRow]);
        const orderBy = vi.fn(() => ({ limit }));
        const where = vi.fn(() => ({ orderBy }));
        const from = vi.fn(() => ({ where }));
        return { from };
      }
      const where = vi.fn().mockResolvedValue([{ id: "mod-1", username: "Moderator" }]);
      const from = vi.fn(() => ({ where }));
      return { from };
    });
    const service = new GuildWarService({ select } as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: {} as D1Database,
    });

    const result = await service.exportHistory("csv", {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content).toContain("\"'=HYPERLINK(\"\"https://evil.example\"\",\"\"open\"\")\"");
    expect(result.data.content).not.toContain("\",\"=HYPERLINK");
  });

  it("moves multiple members through one batched service operation", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      sql,
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn((fields: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn((_filter: unknown) => {
          // GROUP BY query for max sort_order has a .groupBy() continuation
          if ("maxSort" in fields) {
            return {
              groupBy: vi.fn().mockResolvedValue([{ warTeamId: "team-1", maxSort: 1 }]),
            };
          }
          // Username fetch query resolves directly
          return Promise.resolve([
            { id: "u-1", username: "Alpha" },
            { id: "u-2", username: "Beta" },
          ]);
        }),
      })),
    }));
    const service = new GuildWarService({ select } as never, {
      media: { get: vi.fn() },
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      rawDb: { prepare, batch } as never,
    });
    vi.spyOn(service, "getTeamsForEvent").mockResolvedValue([
      { id: "team-1", warHistoryId: null, eventId: "event-1", teamName: "Alpha", sortOrder: 0, notes: null, isLocked: false },
    ]);
    vi.spyOn(service, "getMembersForTeams").mockResolvedValue([]);

    const result = await service.moveMembers("mod-1", "event-1", [
      { user_id: "u-1", to: "team-1" },
      { user_id: "u-2", to: "pool" },
    ]);

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id IN"));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "move_member",
      detailText: expect.stringContaining("\"count\":2"),
    }));
  });

  it("returns the existing history for an idempotent conclude retry", async () => {
    const batch = vi.fn();
    const service = new GuildWarService({} as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: { batch } as never,
    });
    vi.spyOn(service, "getLatestWarHistory").mockResolvedValue({
      ...historyRow,
      result: "win",
    });
    const getTeamsForEvent = vi.spyOn(service, "getTeamsForEvent");

    const result = await service.concludeWar("mod-1", "event-1", {
      result: "win",
    });

    expect(result).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "This guild war event already has a history record",
      details: { war_history_id: "war-1" },
    });
    expect(getTeamsForEvent).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("maps a concurrent conclude unique violation to a conflict without leaking database errors", async () => {
    const batch = vi.fn().mockRejectedValue(
      new Error("D1_ERROR: UNIQUE constraint failed: war_history.event_id"),
    );
    const service = createConcludeService(batch);
    vi.spyOn(service, "getLatestWarHistory")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...historyRow, result: "win" });

    const result = await service.concludeWar("mod-1", "event-1", {
      result: "win",
    });

    expect(result).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "This guild war event already has a history record",
      details: { war_history_id: "war-1" },
    });
    expect(JSON.stringify(result)).not.toContain("UNIQUE constraint");
  });

  it("keeps unrelated conclude failures generic for clients", async () => {
    const batch = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const service = createConcludeService(batch);
    vi.spyOn(service, "getLatestWarHistory").mockResolvedValue(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await service.concludeWar("mod-1", "event-1", {
      result: "win",
    });

    expect(result).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      message: "Failed to conclude war",
    });
    expect(JSON.stringify(result)).not.toContain("database unavailable");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("maps duplicate event history creates and reassignment updates to conflicts", async () => {
    const uniqueError = new Error(
      "D1_ERROR: UNIQUE constraint failed: war_history.event_id",
    );
    const values = vi.fn().mockRejectedValue(uniqueError);
    const where = vi.fn().mockRejectedValue(uniqueError);
    const set = vi.fn(() => ({ where }));
    const service = new GuildWarService({
      insert: vi.fn(() => ({ values })),
      update: vi.fn(() => ({ set })),
    } as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      rawDb: {} as never,
    });
    vi.spyOn(service, "getWarHistoryById").mockResolvedValue(historyRow);
    vi.spyOn(service, "getLatestWarHistory")
      .mockResolvedValueOnce({ ...historyRow, id: "war-existing" })
      .mockResolvedValueOnce({ ...historyRow, id: "war-existing" });

    const createResult = await service.createHistory("mod-1", {
      event_id: "event-1",
      war_name: "Duplicate",
    });
    const updateResult = await service.updateHistory("mod-1", "war-1", {
      event_id: "event-2",
    });

    expect(createResult).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "This guild war event already has a history record",
      details: { war_history_id: "war-existing" },
    });
    expect(updateResult).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "This guild war event already has a history record",
      details: { war_history_id: "war-existing" },
    });
  });

  it("updates multiple role tags through one batched service operation", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      sql,
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn((fields: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(
          "username" in fields
            ? [
                { id: "u-1", username: "Alpha" },
                { id: "u-2", username: "Beta" },
              ]
            : [
                { id: "member-1", userId: "u-1" },
                { id: "member-2", userId: "u-2" },
              ],
        ),
      })),
    }));
    const service = new GuildWarService({ select, update: vi.fn() } as never, {
      media: { get: vi.fn() },
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      rawDb: { prepare, batch } as never,
    });
    vi.spyOn(service, "getTeamsForEvent").mockResolvedValue([
      { id: "team-1", warHistoryId: null, eventId: "event-1", teamName: "Alpha", sortOrder: 0, notes: null, isLocked: false },
    ]);

    const result = await service.setRoleTags("mod-1", "event-1", [
      { user_id: "u-1", role_tag: "tank" },
      { user_id: "u-2", role_tag: null },
    ]);

    expect(result).toEqual({ ok: true, data: { ok: true, updated: 2 } });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE war_team_members SET role_tag"));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "set_role_tag",
      detailText: expect.stringContaining("\"count\":2"),
    }));
  });

  it("copies event team assignments when creating history from an event", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const service = new GuildWarService({ insert: vi.fn(() => ({ values })) } as never, {
      media: { get: vi.fn() },
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      rawDb: {} as never,
    });
    vi.spyOn(service, "getWarHistoryById").mockImplementation(async (warId) => ({ ...historyRow, id: warId }));
    vi.spyOn(service, "getTeamsForEvent").mockResolvedValue([
      { id: "event-team-1", warHistoryId: null, eventId: "event-1", teamName: "Alpha", sortOrder: 0, notes: "front", isLocked: true },
    ]);
    vi.spyOn(service, "getMembersForTeams").mockResolvedValue([
      { id: "member-1", warTeamId: "event-team-1", userId: "user-1", roleTag: "tank", sortOrder: 0, stats: null, note: null },
    ]);
    vi.spyOn(service, "getPoolMembersForEvent").mockResolvedValue([
      { id: "pool-1", warHistoryId: null, eventId: "event-1", userId: "user-2" },
    ]);
    const replaceHistoryTeams = vi.spyOn(service, "replaceHistoryTeams").mockResolvedValue(undefined);

    const result = await service.createHistory("admin-1", {
      event_id: "event-1",
      war_name: "[systemtest] War",
    });

    expect(result.ok).toBe(true);
    expect(replaceHistoryTeams).toHaveBeenCalledWith(expect.any(String), {
      teams: [
        {
          team_name: "Alpha",
          sort_order: 0,
          notes: "front",
          is_locked: true,
          members: [{ user_id: "user-1", role_tag: "tank", sort_order: 0 }],
        },
      ],
      pool_members: [{ user_id: "user-2" }],
    });
  });
});
