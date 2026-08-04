import { afterEach, describe, expect, it, vi } from "vitest";
import { computeHorizon, runEventInstanceGenerationCron } from "./event-instance-gen";

const drizzleMock = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm/d1", () => ({
  drizzle: drizzleMock,
}));

describe("event instance generation horizon", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    drizzleMock.mockReset();
  });

  it("generates recurring event instances for the next 3 days", () => {
    const now = new Date("2026-05-03T00:00:00.000Z");

    expect(computeHorizon(now).toISOString()).toBe("2026-05-06T00:00:00.000Z");
  });

  it("extends horizon by offset minutes", () => {
    const now = new Date("2026-05-03T00:00:00.000Z");

    expect(computeHorizon(now, 60).toISOString()).toBe("2026-05-06T01:00:00.000Z");
  });

  it("copies auto-archive settings from recurring templates to generated instances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T09:30:00.000Z"));
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const templates = [
      {
        id: "tpl-1",
        type: "social",
        title: "Daily Run",
        description: null,
        startTime: "10:00",
        durationMinutes: 60,
        capacity: null,
        createdBy: "user-1",
        recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1 }),
        lastGeneratedDate: null,
        generationCount: 0,
        visibilityOffsetMinutes: 60,
        autoArchive: true,        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
    };
    drizzleMock.mockReturnValue(db);

    await runEventInstanceGenerationCron({
      DB: {
        prepare: (sql: string) => ({ bind: (...bindings: unknown[]) => {
          const statement = { sql, bindings };
          prepared.push(statement);
          return { ...statement, all: async () => ({ results: [] }) };
        } }),
        batch: async (statements: unknown[]) => statements.map(() => ({ meta: { changes: 1 } })),
      },
    } as never);

    const eventInserts = prepared.filter((statement) => statement.sql.includes("INSERT INTO events"));
    expect(eventInserts.length).toBeGreaterThan(0);
    expect(eventInserts.every((statement) => statement.bindings[7] === 1)).toBe(true);
    expect(eventInserts.every((statement) => !statement.sql.includes("visible_at"))).toBe(true);
  });

  it("copies template class quotas onto every newly generated instance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T09:30:00.000Z"));
    const templates = [
      {
        id: "tpl-quota",
        type: "guild_war",
        title: "Quota Run",
        description: null,
        startTime: "10:00",
        durationMinutes: 60,
        capacity: 20,
        createdBy: "user-1",
        recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1, endAfter: 1 }),
        lastGeneratedDate: null,
        generationCount: 0,
        visibilityOffsetMinutes: 60,
        autoArchive: false,
        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
    };
    drizzleMock.mockReturnValue(db);
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const rawDb = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => {
          const statement = { sql, bindings };
          prepared.push(statement);
          return {
            ...statement,
            all: async () => ({ results: [] }),
            first: async () => ({ id: "tpl-quota" }),
          };
        },
      }),
      batch: async (statements: unknown[]) => statements.map(() => ({ meta: { changes: 1 } })),
    };

    await runEventInstanceGenerationCron({ DB: rawDb } as never);

    const createdIds = prepared
      .filter((statement) => statement.sql.includes("INSERT INTO events"))
      .map((statement) => statement.bindings[0])
      .filter((id): id is string => typeof id === "string");
    expect(createdIds).not.toHaveLength(0);
    const copyStatements = prepared.filter((statement) => statement.sql.includes("INSERT INTO event_class_quotas"));
    // 每个新生成的活动都要复制一次，绑定的是它自己的 id 加模板 id。
    expect(copyStatements.map((statement) => statement.bindings)).toEqual(
      createdIds.map((id) => [id, "tpl-quota"]),
    );
    /* 复制的只是「指着目录标签」的那些格。模板私有的一次性组走另一条路——它必须按活动
       各造一份，不能让活动指着模板那一行，否则删模板会把已生成活动的配额一起带走。 */
    expect(copyStatements[0]?.sql).toContain("SELECT ?1, q.tag_id, q.required FROM recurring_template_class_quotas q");
    expect(copyStatements[0]?.sql).toContain("t.owner_kind IS NOT NULL");
  });

  it("writes media references for generated instances with attachments", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T09:30:00.000Z"));
    const templates = [
      {
        id: "tpl-3",
        type: "social",
        title: "Attachment Run",
        description: null,
        startTime: "10:00",
        durationMinutes: 60,
        capacity: null,
        createdBy: "user-1",
        recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1 }),
        lastGeneratedDate: null,
        generationCount: 0,
        visibilityOffsetMinutes: 60,
        autoArchive: false,        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ];
    const rawPrepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({
        sql,
        bindings,
        all: vi.fn().mockResolvedValue({
          results: sql.includes("recurring_template_attachments")
            ? [{ owner_id: "tpl-3", value: "events/tpl-3/images/banner.png" }]
            : [],
        }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockResolvedValue({ id: "tpl-3" }),
      })),
    }));
    const rawBatch = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
    };
    drizzleMock.mockReturnValue(db);

    const mockDb = { prepare: rawPrepare, batch: rawBatch };
    await runEventInstanceGenerationCron({ DB: mockDb } as never);

    // replaceMediaRefs is called for the inserted instance
    expect(rawBatch).toHaveBeenCalled();
    const batchArgs = ((rawBatch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]])[0];
    // batch has at least 2 statements: DELETE + INSERT for media_references
    expect(batchArgs.length).toBeGreaterThanOrEqual(2);
  });

  it("registers every materialized event id with the active system-test run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T09:30:00.000Z"));
    const templates = [{
      id: "tpl-system-test",
      type: "social",
      title: "System Test Run",
      description: null,
      startTime: "10:00",
      durationMinutes: 60,
      capacity: null,
      createdBy: "admin-1",
      recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1, endAfter: 1 }),
      lastGeneratedDate: null,
      generationCount: 0,
      visibilityOffsetMinutes: 60,
      autoArchive: false,
      createdAt: "2026-05-03T10:00:00.000Z",
    }];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
    };
    drizzleMock.mockReturnValue(db);
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const rawDb = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => {
          const statement = { sql, bindings };
          prepared.push(statement);
          return {
            ...statement,
            all: async () => ({ results: [] }),
            first: async () => ({ id: "tpl-system-test" }),
          };
        },
      }),
      batch: async (statements: unknown[]) => statements.map(() => ({ meta: { changes: 1 } })),
    };

    await runEventInstanceGenerationCron(
      { DB: rawDb } as never,
      { templateId: "tpl-system-test", systemTestRunId: "run-1" } as never,
    );

    const createdIds = prepared
      .filter((statement) => statement.sql.includes("INSERT INTO events"))
      .map((statement) => statement.bindings[0])
      .filter((id): id is string => typeof id === "string");
    expect(createdIds).not.toHaveLength(0);
    expect(prepared.some((statement) =>
      statement.sql.includes("INSERT INTO system_test_artifacts")
      && statement.bindings[0] === "run-1"
      && createdIds.includes(statement.bindings[1] as string)
    )).toBe(true);
  });

  it("delays instance creation until now >= start - offset", async () => {
    vi.useFakeTimers();
    // now is 2026-05-04T07:00Z, next occurrence is 2026-05-04T10:00Z, offset is 120min
    // creation threshold: 2026-05-04T08:00Z — now is before that, so no instance
    vi.setSystemTime(new Date("2026-05-04T07:00:00.000Z"));
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const templates = [
      {
        id: "tpl-2",
        type: "social",
        title: "Offset Run",
        description: null,
        startTime: "10:00",
        durationMinutes: 60,
        capacity: null,
        createdBy: "user-1",
        recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1 }),
        lastGeneratedDate: "2026-05-03",
        generationCount: 1,
        visibilityOffsetMinutes: 120,
        autoArchive: false,        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
    };
    drizzleMock.mockReturnValue(db);

    await runEventInstanceGenerationCron({
      DB: {
        prepare: (sql: string) => ({ bind: (...bindings: unknown[]) => {
          const statement = { sql, bindings };
          prepared.push(statement);
          return { ...statement, all: async () => ({ results: [] }) };
        } }),
      },
    } as never);

    expect(prepared.some((statement) => statement.sql.includes("INSERT INTO events"))).toBe(false);
  });

  it("submits event rows, relations, and template progress in one atomic D1 batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T09:30:00.000Z"));
    const templates = [{
      id: "tpl-atomic",
      type: "social",
      title: "Atomic Run",
      description: null,
      startTime: "10:00",
      durationMinutes: 60,
      capacity: null,
      createdBy: "user-1",
      recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1, endAfter: 1 }),
      lastGeneratedDate: null,
      generationCount: 0,
      visibilityOffsetMinutes: 60,
      autoArchive: false,
      createdAt: "2026-05-03T10:00:00.000Z",
    }];
    drizzleMock.mockReturnValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
    });
    const rawBatch = vi.fn().mockRejectedValue(new Error("relation write failed"));
    const rawDb = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => ({
          sql,
          bindings,
          all: async () => ({
            results: sql.includes("recurring_template_attachments")
              ? [{ owner_id: "tpl-atomic", value: "events/tpl-atomic/images/banner.webp" }]
              : [],
          }),
        }),
      }),
      batch: rawBatch,
    };

    await expect(runEventInstanceGenerationCron({ DB: rawDb } as never)).rejects.toThrow("relation write failed");
    expect(rawBatch).toHaveBeenCalledTimes(1);
    const statements = rawBatch.mock.calls[0]![0] as Array<{ sql: string }>;
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("UPDATE recurring_templates");
    expect(sql).toContain("INSERT INTO events");
    expect(sql).toContain("INSERT INTO event_attachments");
    expect(sql).toContain("INSERT OR IGNORE INTO media_references");
  });
});
