import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { EventAggregate } from "./model.js";
import type { EventGuildWarLifecycleStore, EventsStore } from "./model.js";
import { EventsService, selectRaffleWinnerIds } from "./events-service.js";

const NOW = "2026-08-09T12:00:00.000Z";

it("selects raffle winners with a partial shuffle without mutating the participant list", () => {
  const participantIds = Array.from({ length: 500 }, (_, index) => `user-${index}`);
  const original = [...participantIds];
  const winners = selectRaffleWinnerIds(participantIds, participantIds.length, () => 0.999999);

  expect(participantIds).toEqual(original);
  expect(new Set(winners)).toEqual(new Set(original));
});

function context(permissions: readonly string[] | null) {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext(permissions === null ? null : {
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions,
    }),
    now: NOW,
  });
}

function aggregate(type: EventAggregate["event"]["type"], visibleAt: string | null): EventAggregate {
  return {
    event: {
      id: "event-1",
      type,
      title: "Event",
      description: null,
      startAt: "2026-08-10T12:00:00.000Z",
      endAt: "2026-08-10T13:00:00.000Z",
      capacity: 10,
      pinned: false,
      signupLocked: false,
      autoArchive: false,
      autoArchived: false,
      visibleAt,
      archivedAt: null,
      createdBy: "admin-1",
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
      winnerCount: type === "raffle" ? 2 : null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    attachments: [],
    classQuotas: [],
    poll: type === "poll" ? {
      resultsVisibility: "after_vote",
      showVoterNames: false,
      options: [
        { id: "option-1", label: "A", sortOrder: 0, voterIds: ["user-1", "user-2"] },
        { id: "option-2", label: "B", sortOrder: 1, voterIds: [] },
      ],
    } : null,
    raffleWinners: [],
    participants: [
      { id: "participant-1", event_id: "event-1", user_id: "user-1", joined_at: NOW },
      { id: "participant-2", event_id: "event-1", user_id: "user-2", joined_at: NOW },
      { id: "participant-3", event_id: "event-1", user_id: "user-3", joined_at: NOW },
    ],
  };
}

function fakeStore(overrides: Partial<EventsStore> = {}): EventsStore {
  return {
    list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    get: vi.fn(),
    getMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setArchived: vi.fn(),
    touch: vi.fn(),
    addParticipants: vi.fn(),
    removeParticipants: vi.fn(),
    replacePollVote: vi.fn(),
    drawRaffle: vi.fn(),
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    setTemplatePaused: vi.fn(),
    deleteTemplate: vi.fn(),
    materializeDue: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function service(
  store: EventsStore,
  random = () => 0,
  lifecycle: EventGuildWarLifecycleStore = { destroyEvent: vi.fn().mockResolvedValue("deleted") },
  publish = vi.fn(),
) {
  return new EventsService({
    store,
    lifecycle,
    media: {
      list: vi.fn().mockResolvedValue(new Map()),
    },
    notifications: { publish },
    deferred: { defer: (task) => void task() },
    createId: (() => {
      let sequence = 0;
      return () => `generated-${++sequence}`;
    })(),
    random,
  });
}

describe("EventsService notification invalidation", () => {
  it("publishes successful update, archive, and delete mutations", async () => {
    const existing = aggregate("other", null);
    const updated = {
      ...existing,
      event: { ...existing.event, title: "Updated", updatedAt: NOW },
    };
    const publish = vi.fn().mockResolvedValue(undefined);
    const lifecycle = { destroyEvent: vi.fn().mockResolvedValue("deleted" as const) };
    const events = service(fakeStore({
      get: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue(updated),
      setArchived: vi.fn().mockResolvedValue(undefined),
    }), () => 0, lifecycle, publish);

    await events.update(context(["events.edit"]), existing.event.id, { title: "Updated" });
    await events.archive(context(["events.archive"]), existing.event.id);
    await events.destroy(context(["events.delete"]), existing.event.id);

    expect(publish.mock.calls.map(([message]) => message.hint)).toEqual([
      "event_updated",
      "event_archived",
      "event_deleted",
    ]);
  });

  it("does not publish archive/delete hints for no-op or failed mutations", async () => {
    const current = aggregate("other", null);
    const archived = { ...current, event: { ...current.event, archivedAt: NOW } };
    const publish = vi.fn().mockResolvedValue(undefined);
    const lifecycle = { destroyEvent: vi.fn().mockResolvedValue("not_found" as const) };
    const events = service(fakeStore({ get: vi.fn().mockResolvedValue(archived) }), () => 0, lifecycle, publish);

    await events.archive(context(["events.archive"]), archived.event.id);
    await expect(events.destroy(context(["events.delete"]), archived.event.id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("EventsService guild-war lifecycle authorization", () => {
  it("requires guild-war team permission before deleting an active war with its event", async () => {
    const destroyEvent = vi.fn().mockResolvedValue("active_war_permission_required");
    const events = service(
      fakeStore({ get: vi.fn().mockResolvedValue(aggregate("guild_war", null)) }),
      () => 0,
      { destroyEvent },
    );

    await expect(events.destroy(context(["events.delete"]), "event-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(destroyEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      allowActiveWarDelete: false,
    }));

    destroyEvent.mockResolvedValue("deleted");
    await expect(events.destroy(
      context(["events.delete", "guildwar.teams.edit"]),
      "event-1",
    )).resolves.toBeUndefined();
    expect(destroyEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      eventId: "event-1",
      allowActiveWarDelete: true,
    }));
  });
});

describe("EventsService visibility", () => {
  it("uses one visibility policy for anonymous, guild-war editor, and event editor reads", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    const events = service(fakeStore({ list }));
    const query = { page: 1, limit: 20 };
    await events.list(context(null), query);
    await events.list(context(["guildwar.teams.edit"]), query);
    await events.list(context(["events.edit"]), query);
    expect(list.mock.calls.map((call) => call[1])).toEqual([
      { visibleAtOrBefore: NOW, includeHiddenGuildWars: false },
      { visibleAtOrBefore: NOW, includeHiddenGuildWars: true },
      { visibleAtOrBefore: null, includeHiddenGuildWars: true },
    ]);
  });

  it("reveals a hidden guild war only to guild-war or event editors", async () => {
    const hiddenWar = aggregate("guild_war", "2026-08-10T12:00:00.000Z");
    const events = service(fakeStore({ get: vi.fn().mockResolvedValue(hiddenWar) }));
    await expect(events.detail(context(null), hiddenWar.event.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(events.detail(context(["guildwar.teams.edit"]), hiddenWar.event.id)).resolves.toMatchObject({ event: { id: hiddenWar.event.id } });
    await expect(events.detail(context(["events.edit"]), hiddenWar.event.id)).resolves.toMatchObject({ event: { id: hiddenWar.event.id } });
  });

  it("projects poll results and voter identities before returning an event", async () => {
    const poll = aggregate("poll", null);
    const events = service(fakeStore({ get: vi.fn().mockResolvedValue(poll) }));

    const anonymous = await events.detail(context(null), poll.event.id);
    const voter = await events.detail(context([]), poll.event.id);
    const editor = await events.detail(context(["events.edit"]), poll.event.id);

    expect(anonymous.poll?.options[0]).toMatchObject({
      voteCount: 0,
      visibleVoterIds: [],
      votedByViewer: false,
    });
    expect(voter.poll?.options[0]).toMatchObject({
      voteCount: 2,
      visibleVoterIds: [],
      votedByViewer: true,
    });
    expect(editor.poll?.options[0]).toMatchObject({
      voteCount: 2,
      visibleVoterIds: ["user-1", "user-2"],
      votedByViewer: true,
    });
  });
});

describe("EventsService poll and raffle rules", () => {
  it("rejects an invalid poll option before the atomic vote write", async () => {
    const replacePollVote = vi.fn();
    const events = service(fakeStore({
      get: vi.fn().mockResolvedValue(aggregate("poll", null)),
      replacePollVote,
    }));
    await expect(events.votePoll(context([]), "event-1", ["missing"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(replacePollVote).not.toHaveBeenCalled();
  });

  it("draws distinct raffle winners through one audited store mutation", async () => {
    const drawRaffle = vi.fn().mockImplementation(async (
      eventId: string,
      winnerIds: readonly string[],
      winnerRowIds: readonly string[],
    ) => winnerIds.map((userId, index) => ({
      id: winnerRowIds[index]!, eventId, userId, drawnAt: NOW,
    })));
    const events = service(fakeStore({
      get: vi.fn().mockResolvedValue(aggregate("raffle", null)),
      drawRaffle,
    }), () => 0);
    const winners = await events.drawRaffle(context(["events.edit"]), "event-1");
    expect(winners.map(({ userId }) => userId)).toEqual(["user-1", "user-2"]);
    expect(drawRaffle).toHaveBeenCalledOnce();
    expect(drawRaffle.mock.calls[0]![5]).toMatchObject({ requestId: expect.any(String), action: "raffle_draw" });
  });
});
