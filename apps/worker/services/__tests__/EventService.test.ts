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
});
