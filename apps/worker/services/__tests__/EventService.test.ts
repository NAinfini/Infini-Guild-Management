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
    createdBy: "mod-1",
    recurrenceRule: null,
    attachments: "[]",
    seriesId: null,
    isSeriesParent: false,
    instanceDate: null,
    lastGeneratedDate: null,
    generationCount: 0,
    visibleAt: null,
    visibilityOffsetHours: null,
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
});
