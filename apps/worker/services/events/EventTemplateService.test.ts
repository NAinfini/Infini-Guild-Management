import { describe, expect, it, vi } from "vitest";
import { EventTemplateService, type TemplateRow } from "./EventTemplateService";

describe("EventTemplateService system-test cleanup registration", () => {
  it("registers exact generated event ids in the same batch that detaches and deletes the template", async () => {
    const rawDb = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => ({
          sql,
          bindings,
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const service = new EventTemplateService({} as never, rawDb as never, {
      getTemplateById: vi.fn(),
      materializeRecurringSeries: vi.fn(),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      systemTestRunId: "run-1",
    });
    const template: TemplateRow = {
      id: "template-1",
      type: "social",
      title: "Test",
      description: null,
      startTime: "10:00",
      durationMinutes: 60,
      capacity: null,
      recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1 }),
      visibilityOffsetMinutes: 0,
      autoArchive: false,
      attachments: "[]",
      paused: false,
      createdBy: "admin-1",
      lastGeneratedDate: null,
      generationCount: 0,
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
    };

    await service.deleteTemplate("admin-1", template.id, template);

    const firstBatch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; bindings: unknown[] }>;
    expect(firstBatch).toHaveLength(5);
    expect(firstBatch[0]?.sql).toContain("SELECT id FROM system_test_runs");
    expect(firstBatch[1]?.sql).toContain("SELECT ?1, 'event', id FROM events");
    expect(firstBatch[2]?.sql).toContain("UPDATE events SET series_id = NULL");
    // 配额行必须跟模板同批删掉，靠外键级联的话本地 D1 关掉外键就会留下孤儿行。
    expect(firstBatch[3]?.sql).toContain("DELETE FROM recurring_template_class_quotas");
    expect(firstBatch[4]?.sql).toContain("DELETE FROM recurring_templates");
  });
});
