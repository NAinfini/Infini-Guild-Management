
import { DEFAULT_SITE_MEDIA_POLICY } from "@guild/shared";
import { describe, expect, it, vi } from "vitest";
import { EventService } from "../EventService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";
const NEW_MEDIA_ID = "Vbcdefghijklmnopqrstu";

function imageUpload() {
  return { full: new ArrayBuffer(1), view: new ArrayBuffer(1) };
}

function createMediaService() {
  return {
    checkQuota: vi.fn().mockResolvedValue(true),
    createImages: vi.fn().mockResolvedValue({
      expiresAt: "2026-03-09T12:00:00.000Z",
      mediaIds: [NEW_MEDIA_ID],
    }),
    listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
    listLinkedMediaIds: vi.fn().mockResolvedValue([]),
    replace: vi.fn().mockResolvedValue(undefined),
  };
}

const stubTemplateDeps = {
  mediaService: createMediaService() as never,
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
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      })),
    })),
    batch: vi.fn().mockResolvedValue([]),
  };
}

function createSequentialSelectDb(rowsBySelect: unknown[][]) {
  const pending = [...rowsBySelect];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = pending.shift() ?? [];
        const promise = Promise.resolve(rows);
        return {
          limit: vi.fn().mockResolvedValue(rows),
          then: promise.then.bind(promise),
          catch: promise.catch.bind(promise),
          finally: promise.finally.bind(promise),
        };
      }),
    })),
  }));
  return { select };
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
    attachments: [],
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
  it("creates the event domain batch before attaching canonical media ids", async () => {
    const mediaService = createMediaService();
    const getEventById = vi.fn().mockResolvedValue(createEventRow({ attachments: [NEW_MEDIA_ID] }));
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const rawDb = makeRawDb();
    const service = new EventService({} as never, rawDb as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById,
      getUsername: vi.fn().mockResolvedValue("TestUser"),
      writeAuditLog,
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
      createId: () => "evt-1",
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
      [imageUpload()],
    );

    expect(created).toMatchObject({ ok: true, data: { attachments: [NEW_MEDIA_ID] } });
    expect(mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "event_image",
      scope: { kind: "entity", entityType: "event", entityId: "evt-1" },
    }));
    expect(mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "event_image",
      maxBytes: DEFAULT_SITE_MEDIA_POLICY.max_file_size_bytes.event_image,
    }));
    expect(mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "event",
      entityId: "evt-1",
      media: [{ mediaId: NEW_MEDIA_ID, sortOrder: 0 }],
      ownerUserId: "mod-1",
    }));
    const createBatch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string }>;
    expect(createBatch.map(({ sql }) => sql).join("\n")).toContain("INSERT INTO events");
    expect(rawDb.batch.mock.invocationCallOrder[0]).toBeLessThan(
      mediaService.replace.mock.invocationCallOrder[0]!,
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityId: "evt-1" }));
  });

  it("does not attach event media when the domain batch fails", async () => {
    const failure = new Error("event insert failed");
    const mediaService = createMediaService();
    const rawDb = makeRawDb();
    rawDb.batch.mockRejectedValueOnce(failure);
    const service = new EventService({} as never, rawDb as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      createId: () => "evt-create-failure",
    }, stubTemplateDeps);

    await expect(service.createEvent(
      "mod-1",
      { type: "social", title: "Guild Run", start_at: "2026-03-20T19:00:00.000Z", attachments: [] },
      [imageUpload()],
    )).rejects.toBe(failure);

    expect(mediaService.replace).not.toHaveBeenCalled();
  });

  it("deletes the event parent if media attachment fails", async () => {
    const failure = new Error("event attachment failed");
    const mediaService = createMediaService();
    mediaService.replace.mockRejectedValueOnce(failure);
    const rawDb = makeRawDb();
    const service = new EventService({} as never, rawDb as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      createId: () => "evt-attachment-failure",
    }, stubTemplateDeps);

    await expect(service.createEvent(
      "mod-1",
      { type: "social", title: "Guild Run", start_at: "2026-03-20T19:00:00.000Z", attachments: [] },
      [imageUpload()],
    )).rejects.toBe(failure);

    expect(rawDb.prepare).toHaveBeenCalledWith("DELETE FROM events WHERE id = ?1");
  });

  it("updates event auto-archive settings", async () => {
    const rawDb = makeRawDb();
    const service = new EventService({} as never, rawDb as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn().mockResolvedValue(createEventRow({ autoArchive: true })),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await service.updateEvent("mod-1", "evt-1", createEventRow(), {
      auto_archive: true,
    });

    expect(rawDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE events SET"));
    const updateStatement = (rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; bindings: unknown[] }>)[0];
    expect(updateStatement?.sql).toContain("auto_archive = ?");
    expect(updateStatement?.bindings).toContain(true);
  });

  it("rejects updates when the end date is earlier than the start date", async () => {
    const service = new EventService(
      {
        insert: vi.fn(),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
        delete: vi.fn(),
      } as never,
      {} as never, {
        mediaService: createMediaService() as never,
        getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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

  it("uploads event images and appends their media ids", async () => {
    const mediaService = createMediaService();
    const rawDb = makeRawDb();
    const service = new EventService({} as never, rawDb as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    const result = await service.uploadEventImages(
      "mod-1",
      "evt-1",
      createEventRow({ attachments: [MEDIA_ID] }),
      [imageUpload()],
    );

    expect(result).toEqual({
      ok: true,
      data: { media_ids: [NEW_MEDIA_ID], attachments: [MEDIA_ID, NEW_MEDIA_ID] },
    });
    expect(mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      media: [
        { mediaId: MEDIA_ID, sortOrder: 0 },
        { mediaId: NEW_MEDIA_ID, sortOrder: 1 },
      ],
    }));
    expect(rawDb.prepare).toHaveBeenCalledWith("UPDATE events SET updated_at = ?1 WHERE id = ?2");
  });

  it("restores existing event links when the domain timestamp update fails", async () => {
    const failure = new Error("event update failed");
    const mediaService = createMediaService();
    const rawDb = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: vi.fn().mockRejectedValue(failure) })) })),
      batch: vi.fn(),
    };
    const service = new EventService({} as never, rawDb as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await expect(service.uploadEventImages(
      "mod-1",
      "evt-1",
      createEventRow({ attachments: [MEDIA_ID] }),
      [imageUpload()],
    )).rejects.toBe(failure);

    expect(mediaService.replace).toHaveBeenCalledTimes(2);
    expect(mediaService.replace).toHaveBeenLastCalledWith(expect.objectContaining({
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
    }));
  });

  it("adds multiple participants through one capacity-guarded statement", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({
        sql,
        bindings,
        all: vi.fn().mockResolvedValue({
          results: sql.includes("FROM users")
            ? [{ id: "u-1" }, { id: "u-2" }]
            : sql.includes("INSERT INTO event_participants")
              ? [
                  { id: "p-1", eventId: "evt-1", userId: "u-1", joinedAt: "2026-03-08T12:00:00.000Z" },
                  { id: "p-2", eventId: "evt-1", userId: "u-2", joinedAt: "2026-03-08T12:00:00.000Z" },
                ]
              : [],
        }),
      })),
    }));
    const service = new EventService({} as never, { prepare, batch } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn().mockResolvedValue(createEventRow({ capacity: 5 })),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    const result = await (service as unknown as {
      addParticipants(
        actorId: string,
        eventId: string,
        targetUserIds: string[],
      ): Promise<{ ok: true; participants: Array<{ userId: string }> }>;
    }).addParticipants("mod-1", "evt-1", ["u-1", "u-2"]);

    expect(result.ok).toBe(true);
    expect(batch).not.toHaveBeenCalled();
    const insertSql = prepare.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("INSERT INTO event_participants"));
    expect(insertSql).toContain("WITH requested(user_id) AS");
    expect(insertSql).toContain("lower(hex(randomblob(16)))");
    expect(insertSql).toContain("ON CONFLICT(event_id, user_id) DO NOTHING");
    expect(insertSql).toContain("<= e.capacity");
    expect(insertSql).toContain("RETURNING id");
    expect(insertSql).not.toMatch(/json_each|json_extract/);
  });

  it("rejects a moderator batch when a concurrent signup consumes the remaining capacity", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({
          results: sql.includes("FROM users") ? [{ id: "u-1" }, { id: "u-2" }] : [],
        }),
      })),
    }));
    const service = new EventService(createSequentialSelectDb([[{ count: 2 }]]) as never, { prepare, batch: vi.fn() } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn().mockResolvedValue(createEventRow({ capacity: 2 })),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    const result = await (service as unknown as {
      addParticipants(
        actorId: string,
        eventId: string,
        targetUserIds: string[],
      ): Promise<{ ok: boolean; code?: string }>;
    }).addParticipants("mod-1", "evt-1", ["u-1", "u-2"]);

    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("INSERT INTO event_participants"))).toHaveLength(1);
  });

  it("treats participants inserted concurrently as a successful duplicate no-op", async () => {
    let participantRead = 0;
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const publishEntityChanged = vi.fn().mockResolvedValue(undefined);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({
          results: sql.includes("FROM users")
            ? [{ id: "u-1" }, { id: "u-2" }]
            : sql.includes("SELECT ep.user_id")
              ? (participantRead++ === 0 ? [] : [{ userId: "u-1" }, { userId: "u-2" }])
              : [],
        }),
      })),
    }));
    const service = new EventService({} as never, { prepare, batch: vi.fn() } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn().mockResolvedValue(createEventRow({ capacity: 2 })),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog,
      publishEntityChanged,
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await expect(service.addParticipants("mod-1", "evt-1", ["u-1", "u-2"])).resolves.toEqual({
      ok: true,
      participants: [],
    });
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(publishEntityChanged).not.toHaveBeenCalled();
  });

  it("adds the 99-user boundary without any statement exceeding D1's binding limit", async () => {
    const userIds = Array.from({ length: 99 }, (_, index) => `u-${index}`);
    const participantRows = userIds.map((userId, index) => ({
      id: `p-${index}`,
      eventId: "evt-1",
      userId,
      joinedAt: "2026-03-08T12:00:00.000Z",
    }));
    const boundStatements: Array<{ sql: string; bindings: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => {
        const statement = {
          sql,
          bindings,
          all: vi.fn().mockResolvedValue({
            results: sql.includes("FROM users")
              ? userIds.map((id) => ({ id }))
              : sql.includes("INSERT INTO event_participants")
                ? participantRows
                : [],
          }),
        };
        boundStatements.push(statement);
        return statement;
      }),
    }));
    const service = new EventService({} as never, { prepare, batch: vi.fn() } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn().mockResolvedValue(createEventRow({ capacity: 100 })),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    const result = await service.addParticipants("mod-1", "evt-1", userIds);

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.participants).toHaveLength(99);
    expect(boundStatements.every(({ bindings }) => bindings.length <= 100)).toBe(true);
    const insert = boundStatements.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO event_participants"));
    const relationalInsert = boundStatements.find(({ sql }) => sql.includes("INSERT INTO event_participants"));
    expect(insert).toBeUndefined();
    expect(relationalInsert?.sql).toContain("VALUES (?2)");
    expect(relationalInsert?.sql).toContain("(?100)");
    expect(relationalInsert?.bindings).toHaveLength(100);
  });

  it.each([
    ["archived", { archivedAt: "2026-03-08T12:00:00.000Z" }, [], "Event is archived"],
    ["locked", { signupLocked: true }, [], "Event signup is locked"],
    ["ended", { endAt: "2026-03-08T11:59:59.000Z" }, [], "Event has ended"],
    ["duplicate", {}, [[{ id: "participant-1" }]], "Already joined"],
    ["full", { capacity: 1 }, [[], [{ count: 1 }]], "Event is full"],
  ])("maps a concurrent %s change from the latest event state", async (_label, latestPatch, selectRows, message) => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ run })) }));
    const getEventById = vi.fn()
      .mockResolvedValueOnce(createEventRow({ capacity: 20 }))
      .mockResolvedValueOnce(createEventRow(latestPatch));
    const service = new EventService(
      createSequentialSelectDb(selectRows as unknown[][]) as never,
      { prepare, batch: vi.fn() } as never, {
        mediaService: createMediaService() as never,
        getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
        getEventById,
        getUsername: vi.fn().mockResolvedValue(null),
        writeAuditLog: vi.fn().mockResolvedValue(undefined),
        publishEntityChanged: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-03-08T12:00:00.000Z",
        createId: () => "participant-new",
      },
      stubTemplateDeps,
    );

    await expect(service.joinEvent("member-1", "evt-1")).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message,
    });
    expect(getEventById).toHaveBeenCalledTimes(2);
  });

  it("removes multiple participants with one delete statement", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 2 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const service = new EventService({ select: vi.fn() } as never, { prepare, batch: vi.fn() } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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

  it("removes non-media relations before deleting the event parent", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings, run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) })),
    }));
    const mediaService = createMediaService();
    const service = new EventService({} as never, { prepare, batch } as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await service.destroyEvent("mod-1", "evt-1", createEventRow({ attachments: [MEDIA_ID] }));

    expect(mediaService.replace).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM war_team_members"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM war_teams WHERE event_id"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM war_pool_members WHERE event_id"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE war_history SET event_id = NULL"));
    const sql = (batch.mock.calls[0]?.[0] as Array<{ sql: string }>).map(({ sql: statement }) => statement).join("\n");
    expect(sql).toContain("DELETE FROM events WHERE id");
    expect(sql).not.toContain("event_class_quotas");
    expect(sql).not.toContain("class_tags");
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("surfaces event destruction failure without mutating media links", async () => {
    const failure = new Error("event delete failed");
    const mediaService = createMediaService();
    const rawDb = makeRawDb();
    rawDb.batch.mockRejectedValueOnce(failure);
    const service = new EventService({} as never, rawDb as never, {
      mediaService: mediaService as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn().mockResolvedValue(null),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await expect(service.destroyEvent(
      "mod-1",
      "evt-1",
      createEventRow({ attachments: [MEDIA_ID] }),
    )).rejects.toBe(failure);

    expect(mediaService.replace).not.toHaveBeenCalled();
  });

  it("rejects leaving archived events", async () => {
    const db = {
      select: vi.fn(),
      delete: vi.fn(),
    };
    const writeAuditLog = vi.fn().mockResolvedValue(undefined);
    const publishEntityChanged = vi.fn().mockResolvedValue(undefined);
    const service = new EventService(db as never, {} as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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

  it("creates poll events from the fixed source behavior definition", async () => {
    const db = {};
    const batch = vi.fn().mockResolvedValue([]);
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
    }));
    const service = new EventService(db as never, { prepare, batch } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO events"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO event_polls"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO event_poll_options"));
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("rejects normal signups for poll events", async () => {
    const service = new EventService(
      { select: vi.fn(), delete: vi.fn() } as never,
      { prepare: vi.fn(), batch: vi.fn() } as never, {
        mediaService: createMediaService() as never,
        getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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
      { prepare, batch } as never, {
        mediaService: createMediaService() as never,
        getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
        getEventById: vi.fn().mockResolvedValue(createEventRow({ type: "poll", endAt: "2026-03-20T21:00:00.000Z" })),
        getUsername: vi.fn().mockResolvedValue(null),
          writeAuditLog: vi.fn().mockResolvedValue(undefined),
        publishEntityChanged: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-03-08T12:00:00.000Z",
        createId: vi.fn(),
      },
      stubTemplateDeps,
    );

    const result = await service.votePoll("member-1", "evt-1", ["opt-1", "opt-2"]);

    expect(result).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM event_poll_votes"));
    expect(prepare).toHaveBeenCalledWith(
      "INSERT INTO event_poll_votes (event_id, option_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4)",
    );
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
            ? { results: [{ 1: 1 }] }
            : { results: [{ id: "opt-1", eventId: "evt-1", label: "Raid", sortOrder: 0 }] },
        ),
      })),
    }));
    const service = new EventService(db as never, { prepare, batch: vi.fn() } as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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
    const service = new EventService({ select } as never, makeRawDb() as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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

  it("returns hydrated class quotas in event details", async () => {
    const select = vi.fn((fields: Record<string, unknown>) => {
      if ("title" in fields) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([createEventRow()]),
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
    const rawDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({
            results: sql.includes("FROM event_class_quotas q")
              ? [{ parent_id: "evt-1", tag_id: "tag-dps", required: 2, label: "Damage", owner_kind: null }]
              : sql.includes("FROM class_tag_members m")
                ? [{ tag_id: "tag-dps", class_id: "mage" }]
                : [],
          }),
        })),
      })),
      batch: vi.fn(),
    };
    const service = new EventService({ select } as never, rawDb as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
      getEventById: vi.fn(),
      getUsername: vi.fn(),
      writeAuditLog: vi.fn(),
      publishEntityChanged: vi.fn(),
      now: () => "2026-03-08T12:00:00.000Z",
    }, stubTemplateDeps);

    await expect(service.getEventDetail("evt-1", null, false)).resolves.toEqual(
      expect.objectContaining({
        class_quotas: [{
          tag_id: "tag-dps",
          required: 2,
          label: "Damage",
          class_ids: ["mage"],
          one_time: false,
        }],
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
    const service = new EventService({ select } as never, makeRawDb() as never, {
      mediaService: createMediaService() as never,
      getMediaPolicy: vi.fn().mockResolvedValue(DEFAULT_SITE_MEDIA_POLICY),
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
