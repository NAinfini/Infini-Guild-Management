import { describe, expect, it } from "vitest";
import {
  MAX_GUILD_WAR_MEMBERS,
  concludeWarPayloadSchema,
  createWarHistorySchema,
  guildWarAnalyticsResponseSchema,
  guildWarHistoryQuerySchema,
  moveGuildWarMemberSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
} from "./guild-war";

describe("guild war history query", () => {
  it("coerces a bounded strict query", () => {
    expect(guildWarHistoryQuerySchema.parse({
      page: "2",
      limit: "20",
      date_from: "2026-08-01T00:00:00.000Z",
      date_to: "2026-08-09T23:59:59.999Z",
      search: "  Rivals  ",
    })).toEqual({
      page: 2,
      limit: 20,
      date_from: "2026-08-01T00:00:00.000Z",
      date_to: "2026-08-09T23:59:59.999Z",
      search: "Rivals",
    });
  });

  it("normalizes valid UTC timestamps before comparing the range", () => {
    expect(guildWarHistoryQuerySchema.parse({
      date_from: "2026-08-01T00:00:00Z",
      date_to: "2026-08-01T00:00:00.100Z",
    })).toMatchObject({
      date_from: "2026-08-01T00:00:00.000Z",
      date_to: "2026-08-01T00:00:00.100Z",
    });
  });

  it.each([
    { limit: "21" },
    { limit: "not-a-number" },
    { page: "0" },
    { page: "10001" },
    { date_from: "2026-02-30T00:00:00.000Z" },
    { date_from: "2026-08-10T00:00:00.000Z", date_to: "2026-08-09T00:00:00.000Z" },
    { search: "x".repeat(49) },
    { unknown: "field" },
  ])("rejects invalid query %#", (query) => {
    expect(guildWarHistoryQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("guild war decimal stats", () => {
  it.each(["win", "loss", "draw"])("accepts the fixed %s result", (result) => {
    expect(createWarHistorySchema.parse({ war_name: "Result test", result }).result).toBe(result);
  });

  it.each(["victory", "Victory-now"])("rejects unsupported result %s", (result) => {
    expect(createWarHistorySchema.safeParse({ war_name: "Result test", result }).success).toBe(false);
  });

  it("accepts decimal metrics in every write contract", () => {
    expect(
      createWarHistorySchema.parse({
        war_name: "Decimal test",
        result: "draw",
        own_stats: { distance: 1234.56 },
      }).own_stats,
    ).toEqual({ distance: 1234.56 });

    expect(
      updateMemberStatsSchema.parse({
        stats: { damage: 1234.56 },
      }).stats,
    ).toEqual({ damage: 1234.56 });

    expect(
      concludeWarPayloadSchema.parse({
        event_id: "event-1",
        war_info: {
          result: "win",
          own_stats: { distance: 1234.56 },
        },
        member_stats: [
          {
            user_id: "user-1",
            stats: { damage: 1234.56 },
          },
        ],
      }).member_stats?.[0]?.stats,
    ).toEqual({ damage: 1234.56 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "still rejects non-finite metric %s",
    (metric) => {
      expect(
        updateMemberStatsSchema.safeParse({
          stats: { damage: metric },
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unknown and negative persisted metrics", () => {
    expect(
      createWarHistorySchema.safeParse({
        war_name: "Unknown team metric",
        result: "draw",
        own_stats: { damage: 1 },
      }).success,
    ).toBe(false);
    expect(
      updateMemberStatsSchema.safeParse({
        stats: { distance: 1 },
      }).success,
    ).toBe(false);
    expect(
      updateMemberStatsSchema.safeParse({
        stats: { damage: -1 },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate roster placement and duplicate moves", () => {
    expect(saveTeamsPayloadSchema.safeParse({
      event_id: "event-1",
      teams: [{ team_name: "A", sort_order: 0, members: [{ user_id: "user-1", sort_order: 0 }] }],
      pool_members: [{ user_id: "user-1" }],
    }).success).toBe(false);
    expect(moveGuildWarMemberSchema.safeParse({
      event_id: "event-1",
      moves: [{ user_id: "user-1", to: "pool" }, { user_id: "user-1", to: "remove" }],
    }).success).toBe(false);
  });

  it("bounds the total roster and conclusion member payloads", () => {
    const members = Array.from({ length: MAX_GUILD_WAR_MEMBERS }, (_, index) => ({
      user_id: `user-${index}`,
      sort_order: index,
    }));
    const roster = {
      event_id: "event-1",
      teams: [{ team_name: "A", sort_order: 0, members: members.slice(0, 50) }],
      pool_members: members.slice(50).map(({ user_id }) => ({ user_id })),
    };
    expect(saveTeamsPayloadSchema.safeParse(roster).success).toBe(true);
    expect(saveTeamsPayloadSchema.safeParse({
      ...roster,
      pool_members: [...roster.pool_members, { user_id: "user-over-limit" }],
    }).success).toBe(false);

    const conclusion = {
      event_id: "event-1",
      war_info: { result: "win" as const },
      member_stats: members.map(({ user_id }) => ({ user_id, stats: { kills: 1 } })),
    };
    expect(concludeWarPayloadSchema.safeParse(conclusion).success).toBe(true);
    expect(concludeWarPayloadSchema.safeParse({
      ...conclusion,
      member_stats: [...conclusion.member_stats, { user_id: "user-over-limit", stats: { kills: 1 } }],
    }).success).toBe(false);
  });

  it("parses the fixed analytics wire including decimal values", () => {
    const parsed = guildWarAnalyticsResponseSchema.parse({
      wars: [{
        id: "war-1", event_id: "event-1", war_name: "Week 1", enemy_name: "Rivals", result: "win",
        own_stats: { distance: 10.5 }, enemy_stats: null, duration_minutes: 30, notes: null,
        created_by: "user-1", updated_by: null, created_at: "2026-08-09T00:00:00.000Z",
        updated_at: "2026-08-09T00:00:00.000Z", team_size: 1, modifier: 1,
        modifier_breakdown: [{ factor: "distance", ratio: 1, weight: 1, contribution: 1 }],
      }],
      member_stats: [{ user_id: "user-1", stats: { kills: 2, deaths: 1, assists: 3 } }],
      analytics_settings: {
        reference_duration_minutes: 30,
        modifier_weights: { kills: 1, towers: 0, base_hp: 0, credits: 0, distance: 0 },
      },
    });
    expect(parsed.member_stats[0]?.stats).toEqual({ kills: 2, deaths: 1, assists: 3 });
  });
});
