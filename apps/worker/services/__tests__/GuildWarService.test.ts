import { describe, expect, it } from "vitest";
import {
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
});
