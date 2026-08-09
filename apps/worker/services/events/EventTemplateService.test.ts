import { describe, expect, it, vi } from "vitest";
import { EventTemplateService, toTemplatePayload, type TemplateRow } from "./EventTemplateService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";

function createRawDb() {
  const statements: Array<{ sql: string; bindings: unknown[]; run: ReturnType<typeof vi.fn> }> = [];
  const rawDb = {
    prepare: (sql: string) => ({
      bind: (...bindings: unknown[]) => {
        const statement = { sql, bindings, run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        statements.push(statement);
        return statement;
      },
    }),
    batch: vi.fn().mockResolvedValue([]),
  };
  return { rawDb, statements };
}

function createMediaService() {
  return {
    listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
    listLinkedMediaIds: vi.fn().mockResolvedValue([MEDIA_ID]),
    replace: vi.fn().mockResolvedValue(undefined),
  };
}

const template: TemplateRow = {
  id: "template-1",
  type: "social",
  title: "Test",
  description: null,
  startTime: "10:00",
  durationMinutes: 60,
  capacity: null,
  recurrenceFrequency: "daily",
  recurrenceInterval: 1,
  recurrenceDayOfMonth: null,
  recurrenceEndAfter: null,
  recurrenceEndAt: null,
  weekdays: [],
  visibilityOffsetMinutes: 0,
  autoArchive: false,
  attachments: [MEDIA_ID],
  paused: false,
  createdBy: "admin-1",
  lastGeneratedDate: null,
  generationCount: 0,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
};

describe("EventTemplateService unified media links", () => {
  it("assembles the discriminated API rule from relational recurrence columns", () => {
    expect(toTemplatePayload(template).recurrence_rule).toEqual({ frequency: "daily", interval: 1 });
    expect(toTemplatePayload({
      ...template,
      recurrenceFrequency: "weekly",
      recurrenceInterval: 2,
      recurrenceEndAfter: 8,
      weekdays: [1, 3, 5],
    }).recurrence_rule).toEqual({
      frequency: "weekly",
      interval: 2,
      daysOfWeek: [1, 3, 5],
      endAfter: 8,
    });
    expect(toTemplatePayload({
      ...template,
      recurrenceFrequency: "monthly",
      recurrenceDayOfMonth: 31,
      recurrenceEndAt: "2026-12-31T23:59:59.000Z",
    }).recurrence_rule).toEqual({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 31,
      endDate: "2026-12-31T23:59:59.000Z",
    });
  });

  it("registers generated events, clears their series pair, and deletes the template parent", async () => {
    const { rawDb, statements } = createRawDb();
    const mediaService = createMediaService();
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn(),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      mediaService: mediaService as never,
      systemTestRunId: "run-1",
    });

    await service.deleteTemplate("admin-1", template.id, template);

    expect(mediaService.replace).not.toHaveBeenCalled();
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("SELECT id FROM system_test_runs"),
      expect.stringContaining("SELECT ?1, 'event', id FROM events"),
      expect.stringContaining("UPDATE events SET series_id = NULL, instance_date = NULL"),
      expect.stringContaining("DELETE FROM recurring_templates"),
    ]));
    expect(statements.map(({ sql }) => sql).join("\n")).not.toContain("recurring_template_class_quotas");
    expect(statements.map(({ sql }) => sql).join("\n")).not.toContain("class_tags");
  });

  it("attaches media ids through MediaService when creating a template", async () => {
    const { rawDb, statements } = createRawDb();
    const mediaService = createMediaService();
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn().mockResolvedValue(template),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      mediaService: mediaService as never,
      createId: () => "template-1",
      now: () => "2026-05-04T00:00:00.000Z",
    });

    await service.createTemplate("admin-1", {
      type: "social",
      title: "Test",
      start_time: "10:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
      attachments: [MEDIA_ID],
    });

    expect(mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "recurring_template",
      entityId: "template-1",
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
      ownerUserId: "admin-1",
    }));
    expect(statements.map(({ sql }) => sql)).toContainEqual(expect.stringContaining("INSERT INTO recurring_templates"));
    expect(statements.map(({ sql }) => sql).join("\n")).not.toContain("recurrence_rule");
    expect(rawDb.batch.mock.invocationCallOrder[0]).toBeLessThan(mediaService.replace.mock.invocationCallOrder[0]!);
  });

  it("deletes the template parent if media attachment fails", async () => {
    const failure = new Error("template attachment failed");
    const { rawDb, statements } = createRawDb();
    const mediaService = createMediaService();
    mediaService.replace.mockRejectedValueOnce(failure);
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn(),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      mediaService: mediaService as never,
      createId: () => "template-1",
      now: () => "2026-05-04T00:00:00.000Z",
    });

    await expect(service.createTemplate("admin-1", {
      type: "social",
      title: "Test",
      start_time: "10:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
      attachments: [MEDIA_ID],
    })).rejects.toBe(failure);

    const cleanup = statements.find(({ sql }) => sql === "DELETE FROM recurring_templates WHERE id = ?1");
    expect(cleanup?.run).toHaveBeenCalledOnce();
  });

  it("creates a weekly parent and its weekday rows in one D1 batch", async () => {
    const { rawDb } = createRawDb();
    const weeklyTemplate: TemplateRow = {
      ...template,
      recurrenceFrequency: "weekly",
      recurrenceInterval: 2,
      recurrenceEndAfter: 6,
      weekdays: [1, 4],
    };
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn().mockResolvedValue(weeklyTemplate),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      mediaService: createMediaService() as never,
      createId: () => "template-1",
      now: () => "2026-05-04T00:00:00.000Z",
    });

    await service.createTemplate("admin-1", {
      type: "social",
      title: "Test",
      start_time: "10:00",
      recurrence_rule: { frequency: "weekly", interval: 2, daysOfWeek: [1, 4], endAfter: 6 },
    });

    const batch = rawDb.batch.mock.calls[0]![0] as Array<{ sql: string; bindings: unknown[] }>;
    expect(batch[0]?.sql).toContain("recurrence_frequency");
    expect(batch[0]?.bindings.slice(7, 12)).toEqual(["weekly", 2, null, 6, null]);
    expect(batch.filter(({ sql }) => sql.includes("INSERT INTO recurring_template_weekdays")).map(({ bindings }) => bindings)).toEqual([
      ["template-1", 1],
      ["template-1", 4],
    ]);
  });

  it("switches weekly recurrence to monthly while clearing weekday rows and unrelated columns", async () => {
    const { rawDb } = createRawDb();
    const materializeRecurringSeries = vi.fn().mockResolvedValue(undefined);
    const weeklyTemplate: TemplateRow = {
      ...template,
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      weekdays: [1, 3],
    };
    const updatedTemplate: TemplateRow = {
      ...template,
      recurrenceFrequency: "monthly",
      recurrenceInterval: 2,
      recurrenceDayOfMonth: 31,
      recurrenceEndAt: "2026-12-31T23:59:59.000Z",
    };
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn().mockResolvedValue(updatedTemplate),
      materializeRecurringSeries,
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      mediaService: createMediaService() as never,
      now: () => "2026-05-05T00:00:00.000Z",
    });

    await service.updateTemplate("admin-1", template.id, weeklyTemplate, {
      recurrence_rule: {
        frequency: "monthly",
        interval: 2,
        dayOfMonth: 31,
        endDate: "2026-12-31T23:59:59.000Z",
      },
    });

    const batch = rawDb.batch.mock.calls[0]![0] as Array<{ sql: string; bindings: unknown[] }>;
    expect(batch[0]?.sql).toContain("recurrence_frequency = ?");
    expect(batch[0]?.sql).toContain("recurrence_day_of_month = ?");
    expect(batch[0]?.sql).toContain("recurrence_end_after = ?");
    expect(batch[0]?.sql).toContain("recurrence_end_at = ?");
    expect(batch[0]?.bindings).toEqual(expect.arrayContaining(["monthly", 2, 31, null, "2026-12-31T23:59:59.000Z"]));
    expect(batch.some(({ sql }) => sql.includes("DELETE FROM recurring_template_weekdays"))).toBe(true);
    expect(batch.some(({ sql }) => sql.includes("INSERT INTO recurring_template_weekdays"))).toBe(false);
    expect(materializeRecurringSeries).toHaveBeenCalledWith("template-1");
  });

  it("replaces template media ids when attachments change", async () => {
    const { rawDb } = createRawDb();
    const mediaService = createMediaService();
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn().mockResolvedValue(template),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      mediaService: mediaService as never,
      now: () => "2026-05-05T00:00:00.000Z",
    });

    await service.updateTemplate("admin-1", template.id, template, { attachments: [MEDIA_ID] });

    expect(mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "recurring_template",
      entityId: "template-1",
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
      ownerUserId: "admin-1",
    }));
  });
});
