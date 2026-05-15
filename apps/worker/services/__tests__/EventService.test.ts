import { describe, expect, it, vi } from "vitest";
import { EventService, EventServiceValidationError, parseAttachments } from "../EventService";

function createEventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "evt-1",
    type: "social",
    title: "Guild Run",
    description: null,
    startAt: "2026-03-20T19:00:00.000Z",
    endAt: null,
    capacity: 20,
    pinned: false,
    signupLocked: false,
    archivedAt: null,
    autoArchive: false,
    autoArchived: false,
    createdBy: "mod-1",
    updatedBy: null,
    recurrenceRule: null,
    attachments: "[]",
    seriesId: null,
    isSeriesParent: false,
    instanceDate: null,
    lastGeneratedDate: null,
    generationCount: 0,
    visibleAt: null,
    visibilityOffsetMinutes: null,
    winnerCount: null,
    createdAt: "2026-03-08T12:00:00.000Z",
    updatedAt: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("worker EventService", () => {
  it("creates events, uploads inline files, and materializes recurring series", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    };
    const media = { put: vi.fn().mockResolvedValue(undefined) };
    const getEventById = vi
      .fn()
      .mockResolvedValue(
        createEventRow({
          attachments: JSON.stringify(["events/evt-1/images/poster.png"]),
          recurrenceRule: JSON.stringify({ frequency: "weekly", interval: 1 }),
          isSeriesParent: true,
        }),
      );
    const materializeRecurringSeries = vi.fn().mockResolvedValue(undefined);
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const service = new EventService(db as never, {} as never, media as never, {
      getEventById,
      getUsername: vi.fn().mockResolvedValue("TestUser"),
      materializeRecurringSeries,
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: () => "evt-1",
      createImageKey: () => "events/evt-1/images/poster.png",
    });

    const created = await service.createEvent(
      "mod-1",
      {
        type: "social",
        title: "  Guild Run  ",
        description: "  Bring food  ",
        start_at: "2026-03-20T19:00:00.000Z",
        end_at: "2026-03-20T20:00:00.000Z",
        capacity: 20,
        attachments: [],
        auto_archive: true,
        recurrence_rule: {
          frequency: "weekly",
          interval: 1,
        },
      },
      [new File(["image"], "poster.png", { type: "image/png" })],
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt-1",
        title: "Guild Run",
        description: "Bring food",
        attachments: JSON.stringify(["events/evt-1/images/poster.png"]),
        autoArchive: true,
      }),
    );
    expect(media.put).toHaveBeenCalledTimes(1);
    expect(materializeRecurringSeries).toHaveBeenCalledWith("evt-1");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        actorId: "mod-1",
        entityId: "evt-1",
      }),
    );
    expect(parseAttachments(created.attachments)).toEqual(["events/evt-1/images/poster.png"]);
  });

  it("updates event auto-archive settings", async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      insert: vi.fn(),
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(),
    };
    const service = new EventService(db as never, {} as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow({ autoArchive: true })),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    });

    await service.updateEvent("mod-1", "evt-1", createEventRow(), {
      auto_archive: true,
    });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ autoArchive: true }));
  });

  it("rejects updates when the end date is earlier than the start date", async () => {
    const service = new EventService(
      {
        insert: vi.fn(),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
        delete: vi.fn(),
      } as never,
      {} as never,
      { put: vi.fn() } as never,
      {
        getEventById: vi.fn(),
        getUsername: vi.fn().mockResolvedValue(null),
        materializeRecurringSeries: vi.fn(),
        writeAuditLog: vi.fn(),
        publishEntityChanged: vi.fn(),
      },
    );

    await expect(
      service.updateEvent("mod-1", "evt-1", createEventRow(), {
        start_at: "2026-03-20T21:00:00.000Z",
        end_at: "2026-03-20T20:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(EventServiceValidationError);
  });

  it("uploads additional event images and merges them with existing attachments", async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      insert: vi.fn(),
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(),
    };
    const media = { put: vi.fn().mockResolvedValue(undefined) };
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const service = new EventService(db as never, {} as never, media as never, {
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createImageKey: () => "events/evt-1/images/new.png",
    });

    const result = await service.uploadEventImages(
      "mod-1",
      "evt-1",
      createEventRow({
        attachments: JSON.stringify(["events/existing.png"]),
      }),
      [new File(["image"], "new.png", { type: "image/png" })],
    );

    expect(result.attachments).toEqual(["events/existing.png", "events/evt-1/images/new.png"]);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: JSON.stringify(["events/existing.png", "events/evt-1/images/new.png"]),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "upload_images",
      }),
    );
  });

  it("adds multiple participants through one batched service operation", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ id: "u-1" }, { id: "u-2" }]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            {
              id: "p-1",
              eventId: "evt-1",
              userId: "u-1",
              joinedAt: "2026-03-08T12:00:00.000Z",
            },
            {
              id: "p-2",
              eventId: "evt-1",
              userId: "u-2",
              joinedAt: "2026-03-08T12:00:00.000Z",
            },
          ]),
        })),
      });
    const service = new EventService({ select } as never, { prepare, batch } as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow({ capacity: 5 })),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: vi.fn()
        .mockReturnValueOnce("p-1")
        .mockReturnValueOnce("p-2"),
    });

    const result = await (service as unknown as {
      addParticipants(
        actorId: string,
        eventId: string,
        targetUserIds: string[],
      ): Promise<{ ok: true; participants: Array<{ userId: string }> }>;
    }).addParticipants("mod-1", "evt-1", ["u-1", "u-2"]);

    expect(result.ok).toBe(true);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO event_participants"));
  });

  it("removes multiple participants with one delete statement", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 2 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const service = new EventService({ select: vi.fn() } as never, { prepare, batch: vi.fn() } as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow()),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    });

    const result = await (service as unknown as {
      removeParticipants(actorId: string, eventId: string, targetUserIds: string[]): Promise<{ ok: true; removed: number }>;
    }).removeParticipants("mod-1", "evt-1", ["u-1", "u-2"]);

    expect(result).toEqual({ ok: true, removed: 2 });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM event_participants"));
    expect(bind).toHaveBeenCalledWith("evt-1", "u-1", "u-2");
  });

  it("rejects leaving archived events", async () => {
    const db = {
      select: vi.fn(),
      delete: vi.fn(),
    };
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const publishEntityChanged = vi.fn().mockResolvedValue(undefined);
    const service = new EventService(db as never, {} as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow({ archivedAt: "2026-03-21T12:00:00.000Z" })),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog,
      publishEntityChanged,
    });

    const result = await service.leaveEvent("member-1", "evt-1");

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Event is archived" });
    expect(db.delete).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(publishEntityChanged).not.toHaveBeenCalled();
  });

  it("creates poll events with poll settings and options", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    };
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const service = new EventService(db as never, { prepare, batch } as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow({ type: "poll", endAt: "2026-03-20T21:00:00.000Z" })),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: vi.fn()
        .mockReturnValueOnce("evt-1")
        .mockReturnValueOnce("poll-1")
        .mockReturnValueOnce("opt-1")
        .mockReturnValueOnce("opt-2"),
    });

    await service.createEvent("mod-1", {
      type: "poll",
      title: "Next activity?",
      start_at: "2026-03-20T19:00:00.000Z",
      end_at: "2026-03-20T21:00:00.000Z",
      poll: {
        options: ["Raid", "Dungeon"],
        results_visibility: "after_vote",
        show_voter_names: false,
      },
    });

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ type: "poll", capacity: null }));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO event_polls"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO event_poll_options"));
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("rejects normal signups for poll events", async () => {
    const service = new EventService(
      { select: vi.fn(), delete: vi.fn() } as never,
      { prepare: vi.fn(), batch: vi.fn() } as never,
      { put: vi.fn() } as never,
      {
        getEventById: vi.fn().mockResolvedValue(createEventRow({ type: "poll" })),
        getUsername: vi.fn().mockResolvedValue(null),
        materializeRecurringSeries: vi.fn(),
        writeAuditLog: vi.fn(),
        publishEntityChanged: vi.fn(),
      },
    );

    const result = await service.joinEvent("member-1", "evt-1");

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Poll events do not support signups" });
  });

  it("stores multiple-choice poll votes and replaces previous votes", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const batch = vi.fn().mockResolvedValue([]);
    const service = new EventService(
      { select: vi.fn() } as never,
      { prepare, batch } as never,
      { put: vi.fn() } as never,
      {
        getEventById: vi.fn().mockResolvedValue(createEventRow({ type: "poll", endAt: "2026-03-20T21:00:00.000Z" })),
        getUsername: vi.fn().mockResolvedValue(null),
        materializeRecurringSeries: vi.fn(),
        writeAuditLog: vi.fn().mockResolvedValue(undefined),
        publishEntityChanged: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-03-08T12:00:00.000Z",
        createId: vi.fn()
          .mockReturnValueOnce("vote-1")
          .mockReturnValueOnce("vote-2"),
      },
    );

    const result = await service.votePoll("member-1", "evt-1", ["opt-1", "opt-2"]);

    expect(result).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM event_poll_votes"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO event_poll_votes"));
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("rejects poll option changes after votes exist", async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      update: vi.fn(() => ({ set: updateSet })),
    };
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue(
          sql.includes("event_poll_votes")
            ? { results: [{ id: "vote-1" }] }
            : { results: [{ id: "opt-1", eventId: "evt-1", label: "Raid", sortOrder: 0 }] },
        ),
      })),
    }));
    const service = new EventService(db as never, { prepare, batch: vi.fn() } as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow({ type: "poll", endAt: "2026-03-20T21:00:00.000Z" })),
      getUsername: vi.fn().mockResolvedValue(null),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      now: () => "2026-03-08T12:00:00.000Z",
    });

    await expect(
      service.updateEvent("mod-1", "evt-1", createEventRow({ type: "poll", endAt: "2026-03-20T21:00:00.000Z" }), {
        type: "poll",
        title: "Next activity?",
        start_at: "2026-03-20T19:00:00.000Z",
        end_at: "2026-03-20T21:00:00.000Z",
        poll: {
          options: ["Dungeon", "Raid"],
          results_visibility: "after_vote",
          show_voter_names: false,
        },
      }),
    ).rejects.toBeInstanceOf(EventServiceValidationError);
  });

  it("applies search, pinned, locked, and all-status filters when listing events", async () => {
    function collectColumnNames(value: unknown): string[] {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const names = typeof record.name === "string" ? [record.name] : [];
      const chunks = Array.isArray(record.queryChunks)
        ? record.queryChunks.flatMap(collectColumnNames)
        : [];
      return [...names, ...chunks];
    }

    const filters = (EventService as unknown as {
      buildEventsWhereFilters(params: {
        search?: string;
        pinnedFilter?: boolean;
        lockedFilter?: boolean;
        archivedFilter?: boolean;
      }): unknown[];
    }).buildEventsWhereFilters({
      search: "Guild",
      pinnedFilter: true,
      lockedFilter: true,
    });
    const columnNames = filters.flatMap(collectColumnNames);

    expect(columnNames).toContain("pinned");
    expect(columnNames).toContain("signup_locked");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("description");
    expect(columnNames).not.toContain("archived_at");
  });
});
