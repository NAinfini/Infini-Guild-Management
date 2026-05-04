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
  ownKills: null,
  ownTowers: null,
  ownBaseHp: null,
  ownCredits: null,
  ownDistance: null,
  enemyKills: null,
  enemyTowers: null,
  enemyBaseHp: null,
  enemyCredits: null,
  enemyDistance: null,
  durationMinutes: null,
  notes: null,
  createdBy: "mod-1",
  createdAt: "2026-03-08T12:00:00.000Z",
  updatedAt: "2026-03-08T12:00:00.000Z",
};

describe("GuildWarService helpers", () => {
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
      kills: 5,
      deaths: 2,
      assists: 3,
      damage: 1000,
      healing: 500,
      buildingDamage: 200,
      credits: 100,
      damageTaken: 800,
      note: null,
    });
    expect(payload).toEqual(
      expect.objectContaining({
        id: "member-1",
        user_id: "u-1",
        role_tag: "tank",
        kills: 5,
        deaths: 2,
      }),
    );
  });

  it("buildWarEtag produces deterministic etag", () => {
    const etag = buildWarEtag("war-1", "2026-03-08T12:00:00.000Z");
    expect(typeof etag).toBe("string");
    expect(etag).toBe(buildWarEtag("war-1", "2026-03-08T12:00:00.000Z"));
    expect(etag).not.toBe(buildWarEtag("war-2", "2026-03-08T12:00:00.000Z"));
  });

  it("parseRecurrenceRule handles null and json", () => {
    expect(parseRecurrenceRule(null)).toBeNull();
    expect(parseRecurrenceRule(undefined as unknown as string | null)).toBeNull();
    const rule = { freq: "weekly", interval: 1 };
    expect(parseRecurrenceRule(JSON.stringify(rule))).toEqual(rule);
    expect(parseRecurrenceRule("not json")).toBeNull();
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
        where: vi.fn().mockResolvedValue(
          "maxSort" in fields
            ? [{ maxSort: 1 }]
            : [
                { id: "u-1", username: "Alpha" },
                { id: "u-2", username: "Beta" },
              ],
        ),
      })),
    }));
    const service = new GuildWarService({ select } as never, {
      media: { get: vi.fn() },
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      rawDb: { prepare, batch } as never,
    });
    vi.spyOn(service, "ensureWarHistoryForEvent").mockResolvedValue({
      ...historyRow,
      updatedAt: "2026-03-08T12:00:00.000Z",
    });
    vi.spyOn(service, "getTeamsForHistory").mockResolvedValue([
      { id: "team-1", warHistoryId: "war-1", teamName: "Alpha", sortOrder: 0, notes: null, isLocked: false },
    ]);

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

  it("updates multiple role tags through one batched service operation", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      sql,
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn((fields: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { id: "member-1", userId: "u-1" },
            { id: "member-2", userId: "u-2" },
          ]),
        })),
        where: vi.fn().mockResolvedValue(
          "username" in fields
            ? [
                { id: "u-1", username: "Alpha" },
                { id: "u-2", username: "Beta" },
              ]
            : [],
        ),
      })),
    }));
    const service = new GuildWarService({ select, update: vi.fn() } as never, {
      media: { get: vi.fn() },
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      rawDb: { prepare, batch } as never,
    });
    vi.spyOn(service, "getLatestWarHistory").mockResolvedValue({
      ...historyRow,
      updatedAt: "2026-03-08T12:00:00.000Z",
    });

    const result = await (service as unknown as {
      setRoleTags(
        actorId: string,
        eventId: string,
        updates: Array<{ user_id: string; role_tag: string | null }>,
      ): Promise<{ ok: true; data: { ok: true; updated: number } }>;
    }).setRoleTags("mod-1", "event-1", [
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
});
