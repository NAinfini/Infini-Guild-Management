import { describe, expect, it, vi } from "vitest";
import { EventService, parseAttachments } from "../EventService";

const stubTemplateDeps = {
  getTemplateById: vi.fn().mockResolvedValue(null),
  materializeRecurringSeries: vi.fn().mockResolvedValue(undefined),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
};

function makeRawDb() {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({
        sql,
        bindings,
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      })),
    })),
    batch: vi.fn().mockResolvedValue([]),
  };
}

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
    attachments: "[]",
    seriesId: null,
    instanceDate: null,
    visibleAt: null,
    winnerCount: null,
    createdAt: "2026-03-08T12:00:00.000Z",
    updatedAt: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("worker EventService", () => {
  it("creates events, uploads inline files, and writes audit log", async () => {
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
        }),
      );
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const rawDb = makeRawDb();
    const service = new EventService(db as never, rawDb as never, media as never, {
      getEventById,
      getUsername: vi.fn().mockResolvedValue("TestUser"),
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: () => "evt-1",
      createImageKey: () => "events/evt-1/images/poster.png",
    }, stubTemplateDeps);

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
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        actorId: "mod-1",
        entityId: "evt-1",
      }),
    );
    expect(created).toEqual(expect.objectContaining({ ok: true }));
    const createdData = (created as { ok: true; data: { attachments: string } }).data;
    expect(parseAttachments(createdData.attachments)).toEqual(["events/evt-1/images/poster.png"]);
    // replaceMediaRefs is called after insert
    expect(rawDb.batch).toHaveBeenCalled();
  });

  it("updates event auto-archive settings", async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      insert: vi.fn(),
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(),
    };
    const service = new EventService(db as never, makeRawDb() as never, { put: vi.fn() } as never, {
      getEventById: vi.fn().mockResolvedValue(createEventRow({ autoArchive: true })),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

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
          writeAuditLog: vi.fn(),
        publishEntityChanged: vi.fn(),
      },
      stubTemplateDeps,
    );

    const result = await service.updateEvent("mod-1", "evt-1", createEventRow(), {
      start_at: "2026-03-20T21:00:00.000Z",
      end_at: "2026-03-20T20:00:00.000Z",
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "VALIDATION_ERROR" }));
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
    const rawDb = makeRawDb();
    const service = new EventService(db as never, rawDb as never, media as never, {
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createImageKey: () => "events/evt-1/images/new.png",
    }, stubTemplateDeps);

    const result = await service.uploadEventImages(
      "mod-1",
      "evt-1",
      createEventRow({
        attachments: JSON.stringify(["events/existing.png"]),
      }),
      [new File(["image"], "new.png", { type: "image/png" })],
    );

    expect((result as { ok: true; data: { attachments: string[] } }).data.attachments).toEqual(["events/existing.png", "events/evt-1/images/new.png"]);
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
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: vi.fn()
        .mockReturnValueOnce("p-1")
        .mockReturnValueOnce("p-2"),
    }, stubTemplateDeps);

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
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    }, stubTemplateDeps);

    const result = await (service as unknown as {
      removeParticipants(actorId: string, eventId: string, targetUserIds: string[]): Promise<{ ok: true; removed: number }>;
    }).removeParticipants("mod-1", "evt-1", ["u-1", "u-2"]);

    expect(result).toEqual({ ok: true, removed: 2 });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM event_participants"));
    expect(bind).toHaveBeenCalledWith("evt-1", "u-1", "u-2");
  });

  it("removes active guild-war team data when destroying an event", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings, run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) })),
    }));
    const service = new EventService({} as never, { prepare, batch } as never, { put: vi.fn() } as never, {
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await service.destroyEvent("mod-1", "evt-1", createEventRow());

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM war_team_members"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM war_teams WHERE event_id"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM war_pool_members WHERE event_id"));
    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM media_references"));
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
      writeAuditLog,
      publishEntityChanged,
    }, stubTemplateDeps);

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
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: vi.fn()
        .mockReturnValueOnce("evt-1")
        .mockReturnValueOnce("poll-1")
        .mockReturnValueOnce("opt-1")
        .mockReturnValueOnce("opt-2"),
    }, stubTemplateDeps);

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
    // batch is called once for poll creation and once for replaceMediaRefs
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("rejects normal signups for poll events", async () => {
    const service = new EventService(
      { select: vi.fn(), delete: vi.fn() } as never,
      { prepare: vi.fn(), batch: vi.fn() } as never,
      { put: vi.fn() } as never,
      {
        getEventById: vi.fn().mockResolvedValue(createEventRow({ type: "poll" })),
        getUsername: vi.fn().mockResolvedValue(null),
          writeAuditLog: vi.fn(),
        publishEntityChanged: vi.fn(),
      },
      stubTemplateDeps,
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
          writeAuditLog: vi.fn().mockResolvedValue(undefined),
        publishEntityChanged: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-03-08T12:00:00.000Z",
        createId: vi.fn()
          .mockReturnValueOnce("vote-1")
          .mockReturnValueOnce("vote-2"),
      },
      stubTemplateDeps,
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
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    const result = await service.updateEvent("mod-1", "evt-1", createEventRow({ type: "poll", endAt: "2026-03-20T21:00:00.000Z" }), {
      type: "poll",
      title: "Next activity?",
      start_at: "2026-03-20T19:00:00.000Z",
      end_at: "2026-03-20T21:00:00.000Z",
      poll: {
        options: ["Dungeon", "Raid"],
        results_visibility: "after_vote",
        show_voter_names: false,
      },
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "VALIDATION_ERROR" }));
  });

  it("hides future-visible event details from public readers while allowing managers", async () => {
    const select = vi.fn((fields: Record<string, unknown>) => {
      if ("title" in fields) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                createEventRow({ visibleAt: "2026-03-09T12:00:00.000Z" }),
              ]),
            })),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      };
    });
    const service = new EventService({ select } as never, makeRawDb() as never, { put: vi.fn() } as never, {
      getEventById: vi.fn(),
      getUsername: vi.fn(),
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await expect(service.getEventDetail("evt-1", null, false)).resolves.toBeNull();
    await expect(service.getEventDetail("evt-1", "mod-1", true)).resolves.toEqual(
      expect.objectContaining({
        id: "evt-1",
        visible_at: "2026-03-09T12:00:00.000Z",
      }),
    );
  });

  it("omits future-visible events from public batch details", async () => {
    const select = vi.fn((fields: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(
          "title" in fields
            ? [createEventRow({ visibleAt: "2026-03-09T12:00:00.000Z" })]
            : [],
        ),
      })),
    }));
    const service = new EventService({ select } as never, makeRawDb() as never, { put: vi.fn() } as never, {
      getEventById: vi.fn(),
      getUsername: vi.fn(),
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await expect(service.batchDetails(["evt-1"], null, false)).resolves.toEqual([]);
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
        canManage?: boolean;
        now?: string;
      }): unknown[];
    }).buildEventsWhereFilters({
      search: "Guild",
      pinnedFilter: true,
      lockedFilter: true,
      canManage: false,
      now: "2026-03-08T12:00:00.000Z",
    });
    const columnNames = filters.flatMap(collectColumnNames);
    const managerColumnNames = (EventService as unknown as {
      buildEventsWhereFilters(params: { canManage?: boolean; now?: string }): unknown[];
    }).buildEventsWhereFilters({
      canManage: true,
      now: "2026-03-08T12:00:00.000Z",
    }).flatMap(collectColumnNames);

    expect(columnNames).toContain("pinned");
    expect(columnNames).toContain("signup_locked");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("description");
    expect(columnNames).toContain("visible_at");
    expect(columnNames).not.toContain("archived_at");
    expect(managerColumnNames).not.toContain("visible_at");
  });
});
