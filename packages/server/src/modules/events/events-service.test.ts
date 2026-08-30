import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { EventAggregate, EventGuildWarLifecycleStore, EventMediaPort, EventsStore, RecurringTemplateAggregate } from "./model.js";
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

function templateAggregate(
  overrides: Partial<RecurringTemplateAggregate["template"]> = {},
): RecurringTemplateAggregate {
  return {
    template: {
      id: "template-1",
      type: "social",
      title: "Template",
      description: "Private detail",
      startTime: "12:00",
      durationMinutes: 60,
      capacity: 10,
      recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [1, 3] },
      visibilityOffsetMinutes: 15,
      autoArchive: false,
      paused: false,
      createdBy: "admin-1",
      lastGeneratedDate: "2026-08-03",
      generationCount: 4,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-03T12:00:00.000Z",
      ...overrides,
    },
    attachments: [],
    classQuotas: [],
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
  media: EventMediaPort = { list: vi.fn().mockResolvedValue(new Map()) },
) {
  return new EventsService({
    store,
    lifecycle,
    media,
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
  it("uses attachment snapshots instead of fetching after committed event and template writes", async () => {
    const createMediaList = vi.fn().mockRejectedValue(new Error("post-commit event media read failed"));
    const createEvents = service(
      fakeStore({
        create: vi.fn().mockResolvedValue(aggregate("other", null)),
        createTemplate: vi.fn().mockResolvedValue(templateAggregate()),
      }),
      () => 0,
      undefined,
      undefined,
      { list: createMediaList },
    );

    await expect(createEvents.create(context(["events.create"]), {
      type: "other",
      title: "Created",
      start_at: "2026-08-10T12:00:00.000Z",
      attachments: ["event-media-1"],
    })).resolves.toMatchObject({ attachments: ["event-media-1"] });
    await expect(createEvents.createTemplate(context(["events.templates"]), {
      type: "social",
      title: "Created template",
      start_time: "12:00",
      recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [1] },
      attachments: ["template-media-1"],
    })).resolves.toMatchObject({ attachments: ["template-media-1"] });
    expect(createMediaList).not.toHaveBeenCalled();

    const event = { ...aggregate("other", null), attachments: ["existing-event-media"] };
    const template = { ...templateAggregate(), attachments: ["existing-template-media"] };
    const updateMediaList = vi.fn()
      .mockResolvedValueOnce(new Map([[event.event.id, event.attachments]]))
      .mockResolvedValueOnce(new Map([[template.template.id, template.attachments]]))
      .mockRejectedValue(new Error("post-commit event media read failed"));
    const updateEvents = service(
      fakeStore({
        get: vi.fn().mockResolvedValue(event),
        update: vi.fn().mockResolvedValue(aggregate("other", null)),
        getTemplate: vi.fn().mockResolvedValue(template),
        updateTemplate: vi.fn().mockResolvedValue(templateAggregate()),
      }),
      () => 0,
      undefined,
      undefined,
      { list: updateMediaList },
    );

    await expect(updateEvents.update(context(["events.edit"]), event.event.id, {
      title: "Saved",
      expected_updated_at: event.event.updatedAt,
    })).resolves.toMatchObject({ attachments: event.attachments });
    await expect(updateEvents.updateTemplate(context(["events.templates"]), template.template.id, {
      title: "Saved",
      expected_updated_at: template.template.updatedAt,
    })).resolves.toMatchObject({ attachments: template.attachments });
    expect(updateMediaList).toHaveBeenCalledTimes(2);
  });

  it("publishes the creation hint and inbox invalidation after a successful create", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const events = service(
      fakeStore({ create: vi.fn().mockResolvedValue(aggregate("other", null)) }),
      () => 0,
      { destroyEvent: vi.fn().mockResolvedValue("deleted") },
      publish,
    );

    await events.create(context(["events.create"]), {
      type: "other",
      title: "Created",
      start_at: "2026-08-10T12:00:00.000Z",
    });

    expect(publish.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({
        type: "entity_changed",
        entity_type: "event",
        entity_id: "generated-1",
        hint: "event_created",
      }),
      { type: "inbox_changed" },
    ]);
  });

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

    await events.update(context(["events.edit"]), existing.event.id, {
      title: "Updated",
      expected_updated_at: NOW,
    });
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

describe("EventsService edit revisions", () => {
  it("passes the read revision to each successful write and rejects stale event or template edits before auditing", async () => {
    const event = aggregate("other", null);
    const template = templateAggregate();
    const update = vi.fn().mockResolvedValue(event);
    const updateTemplate = vi.fn().mockResolvedValue(template);
    const events = service(fakeStore({
      get: vi.fn().mockResolvedValue(event),
      getTemplate: vi.fn().mockResolvedValue(template),
      update,
      updateTemplate,
    }));

    await events.update(context(["events.edit"]), event.event.id, {
      title: "Saved",
      expected_updated_at: event.event.updatedAt,
    });
    await events.updateTemplate(context(["events.templates"]), template.template.id, {
      title: "Saved",
      expected_updated_at: template.template.updatedAt,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: event.event.updatedAt,
      updatedAt: "2026-08-09T12:00:00.001Z",
      audit: expect.any(Object),
    }));
    expect(updateTemplate).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: template.template.updatedAt,
      updatedAt: "2026-08-09T12:00:00.000Z",
      audit: expect.any(Object),
    }));

    await expect(events.update(context(["events.edit"]), event.event.id, {
      title: "Stale",
      expected_updated_at: "2026-08-09T11:59:59.999Z",
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(events.updateTemplate(context(["events.templates"]), template.template.id, {
      title: "Stale",
      expected_updated_at: "2026-08-03T11:59:59.999Z",
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateTemplate).toHaveBeenCalledTimes(1);
  });
});

describe("EventsService audit context", () => {
  it("passes each aggregate snapshot and next revision into child mutations", async () => {
    const member = { id: "participant-1", event_id: "event-1", user_id: "user-1", joined_at: NOW };
    const addParticipants = vi.fn().mockResolvedValue({ participants: [member], changed: true });
    const removeParticipants = vi.fn().mockResolvedValue(1);
    const replacePollVote = vi.fn().mockResolvedValue(true);
    const drawRaffle = vi.fn().mockImplementation(async (input: {
      eventId: string;
      winnerIds: readonly string[];
      winnerRowIds: readonly string[];
    }) => input.winnerIds.map((userId, index) => ({
      id: input.winnerRowIds[index]!, eventId: input.eventId, userId, drawnAt: NOW,
    })));
    const events = service(fakeStore({
      get: vi.fn()
        .mockResolvedValueOnce(aggregate("other", null))
        .mockResolvedValueOnce(aggregate("other", null))
        .mockResolvedValueOnce(aggregate("poll", null))
        .mockResolvedValueOnce(aggregate("raffle", null)),
      addParticipants,
      removeParticipants,
      replacePollVote,
      drawRaffle,
    }));

    await events.join(context([]), "event-1");
    await events.leave(context([]), "event-1");
    await events.votePoll(context([]), "event-1", ["option-1"]);
    await events.drawRaffle(context(["events.edit"]), "event-1");

    const expectedRevision = "2026-08-09T12:00:00.001Z";
    expect(addParticipants).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      expectedUpdatedAt: NOW,
      updatedAt: expectedRevision,
    }));
    expect(removeParticipants).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      expectedUpdatedAt: NOW,
      updatedAt: expectedRevision,
    }));
    expect(replacePollVote).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      expectedUpdatedAt: NOW,
      updatedAt: expectedRevision,
    }));
    expect(drawRaffle).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      expectedUpdatedAt: NOW,
      updatedAt: expectedRevision,
    }));
  });

  it("defers moderator batch outcomes to the atomic store", async () => {
    const addParticipants = vi.fn().mockResolvedValue({ participants: [], changed: false });
    const removeParticipants = vi.fn().mockResolvedValue(2);
    const events = service(fakeStore({
      get: vi.fn().mockResolvedValue(aggregate("other", null)),
      addParticipants,
      removeParticipants,
    }));

    await events.addParticipants(context(["events.edit"]), "event-1", ["user-2", "user-3", "user-2"]);
    await events.removeParticipants(context(["events.edit"]), "event-1", ["user-2", "user-3", "user-2"]);

    const expectedContext = [{
      field: "event_id",
      value: { type: "reference", value: { id: "event-1", label: "Event" } },
    }];
    expect(addParticipants).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      userIds: ["user-2", "user-3"],
      participantIds: expect.any(Array),
      now: NOW,
      mode: "moderator",
      expectedUpdatedAt: NOW,
      updatedAt: "2026-08-09T12:00:00.001Z",
      audit: expect.objectContaining({
        action: "batch_add_by_moderator",
        payload: expect.objectContaining({ context: expectedContext }),
      }),
    }));
    expect(removeParticipants).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      userIds: ["user-2", "user-3"],
      expectedUpdatedAt: NOW,
      updatedAt: "2026-08-09T12:00:00.001Z",
      audit: expect.objectContaining({
        action: "batch_remove_by_moderator",
        payload: expect.objectContaining({ context: expectedContext }),
      }),
    }));
  });

  it("records safe scalar event changes and keeps descriptions out of the payload", async () => {
    const current = aggregate("other", null);
    const update = vi.fn().mockResolvedValue({
      ...current,
      event: { ...current.event, title: "Updated", capacity: 20, pinned: true },
    });
    const events = service(fakeStore({ get: vi.fn().mockResolvedValue(current), update }));

    await events.update(context(["events.edit"]), "event-1", {
      title: "Updated",
      capacity: 20,
      pinned: true,
      description: "New private detail",
      expected_updated_at: NOW,
    });

    expect(update.mock.calls[0]![0].audit.payload).toEqual({
      schema_version: 2,
      changes: [
        { field: "title", before: { type: "text", value: "Event" }, after: { type: "text", value: "Updated" } },
        { field: "capacity", before: { type: "number", value: 10 }, after: { type: "number", value: 20 } },
        { field: "pinned", before: { type: "boolean", value: false }, after: { type: "boolean", value: true } },
      ],
      context: [{
        field: "changed_sections",
        value: { type: "list", value: [{ type: "code", value: "description" }] },
      }],
    });
    expect(JSON.stringify(update.mock.calls[0]![0].audit.payload)).not.toContain("New private detail");
  });
});

describe("EventsService recurrence writes", () => {
  it("preserves explicit null clears for ordinary event updates", async () => {
    const current = {
      ...aggregate("other", null),
      event: { ...aggregate("other", null).event, description: "Private detail" },
    };
    const update = vi.fn().mockResolvedValue({
      ...current,
      event: { ...current.event, description: null, endAt: null, capacity: null },
    });
    const events = service(fakeStore({ get: vi.fn().mockResolvedValue(current), update }));

    await events.update(context(["events.edit"]), "event-1", {
      description: null,
      end_at: null,
      capacity: null,
      expected_updated_at: NOW,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ description: null, endAt: null, capacity: null }),
    }));
  });

  it("uses cron as the only materializer and restarts only changed schedules", async () => {
    const current = templateAggregate();
    const created = templateAggregate({ id: "generated-1", title: "Created" });
    const updated = templateAggregate({ title: "Renamed", updatedAt: NOW });
    const createTemplate = vi.fn().mockResolvedValue(created);
    const updateTemplate = vi.fn().mockResolvedValue(updated);
    const setTemplatePaused = vi.fn().mockResolvedValue(undefined);
    const materializeDue = vi.fn().mockResolvedValue([]);
    const events = service(fakeStore({
      getTemplate: vi.fn().mockResolvedValue(current),
      createTemplate,
      updateTemplate,
      setTemplatePaused,
      materializeDue,
    }));

    await expect(events.createTemplate(context(["events.templates"]), {
      type: "social",
      title: "Created",
      start_time: "12:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
    })).resolves.toMatchObject({ template: { id: "generated-1" } });

    await expect(events.updateTemplate(context(["events.templates"]), "template-1", {
      title: "Renamed",
      description: null,
      duration_minutes: null,
      capacity: null,
      visibility_offset_minutes: 0,
      expected_updated_at: current.template.updatedAt,
    })).resolves.toMatchObject({ template: { title: "Renamed" } });
    expect(updateTemplate.mock.calls[0]![0]).toMatchObject({
      patch: {
        title: "Renamed",
        description: null,
        durationMinutes: null,
        capacity: null,
        visibilityOffsetMinutes: 0,
      },
    });
    expect(updateTemplate.mock.calls[0]![0]).not.toHaveProperty("restartCursorDate");

    await events.updateTemplate(context(["events.templates"]), "template-1", {
      recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [3, 1] },
      expected_updated_at: current.template.updatedAt,
    });
    expect(updateTemplate.mock.calls[1]![0]).not.toHaveProperty("restartCursorDate");

    await events.updateTemplate(context(["events.templates"]), "template-1", {
      start_time: "13:00",
      expected_updated_at: current.template.updatedAt,
    });
    expect(updateTemplate.mock.calls[2]![0]).toMatchObject({ restartCursorDate: "2026-08-08" });

    await events.resumeTemplate(context(["events.templates"]), "template-1");
    expect(setTemplatePaused).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "template-1",
      paused: false,
      expectedUpdatedAt: current.template.updatedAt,
      resumeCursorDate: "2026-08-08",
    }));
    expect(materializeDue).not.toHaveBeenCalled();
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
    const drawRaffle = vi.fn().mockImplementation(async (input: {
      eventId: string;
      winnerIds: readonly string[];
      winnerRowIds: readonly string[];
    }) => input.winnerIds.map((userId, index) => ({
      id: input.winnerRowIds[index]!, eventId: input.eventId, userId, drawnAt: NOW,
    })));
    const events = service(fakeStore({
      get: vi.fn().mockResolvedValue(aggregate("raffle", null)),
      drawRaffle,
    }), () => 0);
    const winners = await events.drawRaffle(context(["events.edit"]), "event-1");
    expect(winners.map(({ userId }) => userId)).toEqual(["user-1", "user-2"]);
    expect(drawRaffle).toHaveBeenCalledOnce();
    expect(drawRaffle.mock.calls[0]![0]).toMatchObject({
      expectedUpdatedAt: NOW,
      updatedAt: "2026-08-09T12:00:00.001Z",
      audit: { requestId: expect.any(String), action: "raffle_draw" },
    });
  });
});
