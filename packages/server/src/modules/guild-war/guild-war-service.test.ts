import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { evaluateKda } from "@guild/shared";
import type { EventAggregate } from "@guild/server/modules/events";
import { GuildWarService } from "./guild-war-service.js";
import type { GuildWarAggregate, GuildWarEventRosterStore, GuildWarStore } from "./model.js";

const NOW = "2026-08-09T12:00:00.000Z";

function context(permissions: readonly string[] | null) {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext(permissions === null ? null : {
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 1,
      permissions,
    }),
    now: NOW,
  });
}

const event: EventAggregate = {
  event: {
    id: "event-1", type: "guild_war", title: "Week 1", description: null,
    startAt: NOW, endAt: null, capacity: null, pinned: false, signupLocked: false,
    autoArchive: false, autoArchived: false, visibleAt: null, archivedAt: null,
    createdBy: "admin-1", updatedBy: null, seriesId: null, instanceDate: null,
    winnerCount: null, createdAt: NOW, updatedAt: NOW,
  },
  attachments: [], classQuotas: [], poll: null, raffleWinners: [],
  participants: [{ id: "participant-1", event_id: "event-1", user_id: "user-1", joined_at: NOW }],
};

function aggregate(status: "active" | "concluded", version = 1): GuildWarAggregate {
  return {
    war: {
      id: "war-1", eventId: "event-1", status, warName: "Week 1", enemyName: status === "concluded" ? "Rivals" : null,
      result: status === "concluded" ? "win" : null,
      ownStats: status === "concluded" ? { kills: 10 } : null,
      enemyStats: status === "concluded" ? { kills: 5 } : null,
      durationMinutes: status === "concluded" ? 30 : null,
      notes: null, rosterVersion: version, concludedAt: status === "concluded" ? NOW : null,
      createdBy: "admin-1", updatedBy: null, createdAt: NOW, updatedAt: NOW,
    },
    teams: [{
      id: "team-1", warId: "war-1", teamName: "Alpha", sortOrder: 0, notes: null, isLocked: false,
      members: [{
        id: "member-1", warId: "war-1", teamId: "team-1", userId: "user-1", username: "One",
        avatarMediaId: null, roleTag: null, sortOrder: 0,
        stats: status === "concluded" ? { kills: 2, deaths: 1, assists: 3 } : null, note: null,
      }],
    }],
    pool: [],
  };
}

function fakeStore(overrides: Partial<GuildWarStore> = {}): GuildWarStore {
  return {
    getByEvent: vi.fn(), getById: vi.fn(), getMany: vi.fn(), getHistoryMany: vi.fn(), listHistory: vi.fn(), concludedEventIds: vi.fn(),
    /* 默认全员可上场；要验证停用成员被挡掉的用例自己覆盖这一项。 */
    listRosterEligible: vi.fn(async (userIds: readonly string[]) => userIds),
    createActive: vi.fn(), replaceRoster: vi.fn(), setRoleTags: vi.fn(), conclude: vi.fn(),
    createHistory: vi.fn(), updateHistory: vi.fn(), deleteHistory: vi.fn(), deleteHistories: vi.fn(),
    updateMemberStats: vi.fn(), readAnalytics: vi.fn(), exportHistory: vi.fn(),
    ...overrides,
  };
}

function service(
  store: GuildWarStore,
  eventRoster: GuildWarEventRosterStore = { moveMembers: vi.fn() },
) {
  const events = {
    findVisible: vi.fn().mockResolvedValue(event),
    getGuildWarTarget: vi.fn().mockResolvedValue(event),
    getGuildWarHistoryTarget: vi.fn().mockResolvedValue(event),
    list: vi.fn(),
  };
  const publish = vi.fn().mockResolvedValue(undefined);
  const deferred: Array<() => Promise<void>> = [];
  return {
    events,
    publish,
    flush: async () => Promise.all(deferred.splice(0).map((task) => task())),
    value: new GuildWarService({
      store,
      eventRoster,
      events,
      analyticsSettings: {
        read: vi.fn().mockResolvedValue({
          reference_duration_minutes: 30,
          modifier_weights: { kills: 1, towers: 0, base_hp: 0, credits: 0, distance: 0 },
        }),
      },
      notifications: { publish },
      deferred: { defer: (task) => { deferred.push(task); } },
      createId: () => "generated-id",
    }),
  };
}

describe("GuildWarService authorization and concurrency", () => {
  it("keeps public reads open while enforcing independent team and history permissions", async () => {
    const replaceRoster = vi.fn();
    const createHistory = vi.fn();
    const fixture = service(fakeStore({ getByEvent: vi.fn().mockResolvedValue(null), replaceRoster, createHistory }));
    await expect(fixture.value.active(context(null), "event-1")).resolves.toMatchObject({ event });
    await expect(fixture.value.saveTeams(context([]), {
      event_id: "event-1", teams: [], pool_members: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(fixture.value.createHistory(context(["guildwar.teams.edit"]), {
      war_name: "Manual", result: "draw",
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(replaceRoster).not.toHaveBeenCalled();
    expect(createHistory).not.toHaveBeenCalled();
  });

  it("keeps deactivated signups out of the roster pool without dropping their signup", async () => {
    /* 报名行还在事件里，但停用的账号上不了场。指挥看到的候补池必须只剩能打的人，
       不然位置会排给一个登不进来的人。 */
    const listRosterEligible = vi.fn().mockResolvedValue([]);
    const fixture = service(fakeStore({
      getByEvent: vi.fn().mockResolvedValue(null),
      listRosterEligible,
    }));

    await expect(fixture.value.active(context(null), "event-1")).resolves.toMatchObject({
      pool: [],
      participants: [],
    });
    expect(listRosterEligible).toHaveBeenCalledWith(["user-1"]);
  });

  it("returns the existing aggregate id when conclude is replayed", async () => {
    const conclude = vi.fn();
    const fixture = service(fakeStore({ getByEvent: vi.fn().mockResolvedValue(aggregate("concluded")), conclude }));
    await expect(fixture.value.conclude(context(["guildwar.teams.edit"]), "event-1", {
      result: "loss",
    })).resolves.toEqual({ war_history_id: "war-1" });
    expect(conclude).not.toHaveBeenCalled();
  });

  it("turns a failed roster CAS into a conflict even without If-Match", async () => {
    const moveMembers = vi.fn().mockResolvedValue(false);
    const fixture = service(
      fakeStore({ getByEvent: vi.fn().mockResolvedValue(aggregate("active")) }),
      { moveMembers },
    );
    await expect(fixture.value.moveMembers(context(["guildwar.teams.edit"]), "event-1", [{
      user_id: "user-1", to: "pool",
    }])).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(moveMembers.mock.calls[0]![0]).toMatchObject({
      expectedVersion: 1,
      audit: {
        action: "move_member",
        payload: {
          context: [{
            field: "destinations",
            value: { type: "list", value: [{ type: "code", value: "pool" }] },
          }],
        },
      },
    });
  });

  it("records the affected members and their assigned duties", async () => {
    const setRoleTags = vi.fn().mockResolvedValue(true);
    const fixture = service(fakeStore({
      getByEvent: vi.fn().mockResolvedValue(aggregate("active")),
      setRoleTags,
    }));

    await expect(fixture.value.setRoleTags(context(["guildwar.teams.edit"]), "event-1", [{
      user_id: "user-1",
      role_tag: "caller",
    }])).resolves.toEqual({ ok: true, updated: 1 });

    expect(setRoleTags).toHaveBeenCalledWith(expect.objectContaining({
      audit: expect.objectContaining({
        action: "set_role_tag",
        payload: expect.objectContaining({
          context: [
            { field: "member_count", value: { type: "number", value: 1 } },
            {
              field: "user_ids",
              value: {
                type: "list",
                value: [{ type: "reference", value: { id: "user-1", label: "One" } }],
              },
            },
            {
              field: "role_tags",
              value: { type: "list", value: [{ type: "code", value: "caller" }] },
            },
          ],
        }),
      }),
    }));
  });

  it("requires event edit permission for removals and publishes both invalidations after success", async () => {
    const moveMembers = vi.fn().mockResolvedValue(true);
    const fixture = service(
      fakeStore({ getByEvent: vi.fn().mockResolvedValue(aggregate("active")) }),
      { moveMembers },
    );

    await expect(fixture.value.moveMembers(
      context(["guildwar.teams.edit"]),
      "event-1",
      [{ user_id: "user-1", to: "remove" }],
    )).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(moveMembers).not.toHaveBeenCalled();

    await expect(fixture.value.moveMembers(
      context(["guildwar.teams.edit", "events.edit"]),
      "event-1",
      [{ user_id: "user-1", to: "remove" }],
    )).resolves.toEqual({ ok: true });
    await fixture.flush();
    expect(fixture.publish.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ entity_type: "guild_war", hint: "members_moved" }),
      expect.objectContaining({ entity_type: "event", hint: "participants_removed_by_moderator" }),
    ]);
  });

  it("atomically enrolls a non-participant when a manager adds them to the pool", async () => {
    const moveMembers = vi.fn().mockResolvedValue(true);
    const fixture = service(
      fakeStore({ getByEvent: vi.fn().mockResolvedValue(aggregate("active")) }),
      { moveMembers },
    );

    await expect(fixture.value.moveMembers(
      context(["guildwar.teams.edit"]),
      "event-1",
      [{ user_id: "user-2", to: "pool" }],
    )).resolves.toEqual({ ok: true });
    expect(moveMembers).toHaveBeenCalledWith(expect.objectContaining({
      moves: [expect.objectContaining({ userId: "user-2", to: "pool", participantId: "generated-id" })],
    }));
    await fixture.flush();
    expect(fixture.publish.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ entity_type: "guild_war", hint: "members_moved" }),
      expect.objectContaining({ entity_type: "event", hint: "participants_added_by_moderator" }),
    ]);
  });

  it("rejects roster users outside the event before creating or replacing a war aggregate", async () => {
    const createActive = vi.fn();
    const replaceRoster = vi.fn();
    const fixture = service(fakeStore({ createActive, replaceRoster }));
    await expect(fixture.value.saveTeams(context(["guildwar.teams.edit"]), {
      event_id: "event-1",
      teams: [{ team_name: "Alpha", sort_order: 0, members: [{ user_id: "user-2", sort_order: 0 }] }],
      pool_members: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(createActive).not.toHaveBeenCalled();
    expect(replaceRoster).not.toHaveBeenCalled();
  });

  it("counts both assigned and pooled members in the saved roster audit", async () => {
    const replaceRoster = vi.fn().mockResolvedValue(true);
    const fixture = service(fakeStore({
      getByEvent: vi.fn().mockResolvedValue(aggregate("active")),
      replaceRoster,
    }));

    await fixture.value.saveTeams(context(["guildwar.teams.edit"]), {
      event_id: "event-1",
      teams: [],
      pool_members: [{ user_id: "user-1" }],
    });

    expect(replaceRoster.mock.calls[0]![0].audit.payload.context).toEqual([
      { field: "team_count", value: { type: "number", value: 0 } },
      { field: "member_count", value: { type: "number", value: 1 } },
    ]);
  });

  it("uses the concluded-only batch reader for history details", async () => {
    const getHistoryMany = vi.fn().mockResolvedValue([aggregate("concluded")]);
    const fixture = service(fakeStore({ getHistoryMany }));
    await expect(fixture.value.historyBatch(context(null), ["war-1"])).resolves.toHaveLength(1);
    expect(getHistoryMany).toHaveBeenCalledWith(["war-1"]);
  });

  it("clears nullable history fields without resolving a null event", async () => {
    const updateHistory = vi.fn().mockResolvedValue(true);
    const fixture = service(fakeStore({
      getById: vi.fn().mockResolvedValue(aggregate("concluded")),
      updateHistory,
    }));

    await fixture.value.updateHistory(context(["guildwar.history.edit"]), "war-1", {
      event_id: null,
      duration_minutes: null,
    });

    expect(fixture.events.getGuildWarHistoryTarget).toHaveBeenCalledWith(expect.anything(), "event-1");
    expect(fixture.events.getGuildWarHistoryTarget).not.toHaveBeenCalledWith(expect.anything(), null);
    expect(updateHistory).toHaveBeenCalledWith(expect.objectContaining({
      patch: { eventId: null, durationMinutes: null },
      audit: expect.objectContaining({
        action: "update",
        payload: expect.objectContaining({
          changes: [{
            field: "event_id",
            before: { type: "reference", value: { id: "event-1", label: "Week 1" } },
            after: { type: "null", value: null },
          }],
          context: [{
            field: "changed_sections",
            value: { type: "list", value: [{ type: "code", value: "duration_minutes" }] },
          }],
        }),
      }),
    }));
  });
});

describe("GuildWarService analytics", () => {
  it("keeps fixed raw KDA sources and computes the configured team modifier", async () => {
    const war = aggregate("concluded").war;
    const fixture = service(fakeStore({
      readAnalytics: vi.fn().mockResolvedValue({
        wars: [{ ...war, ownStats: { kills: 5 }, enemyStats: { kills: 10 } }],
        teamSizes: new Map([["war-1", 1]]),
        memberStats: [{ userId: "user-1", stats: { kills: 2, deaths: 1, assists: 3 } }],
      }),
    }));
    const result = await fixture.value.analytics(context(null), ["war-1"], ["user-1"]);
    expect(result.wars[0]).toMatchObject({ teamSize: 1, modifier: 2 });
    expect(result.memberStats[0]?.stats).toEqual({ kills: 2, deaths: 1, assists: 3 });
    expect(evaluateKda(result.memberStats[0]!.stats)).toBe(5);
  });
});
