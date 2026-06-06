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
    const insertedValues: unknown[] = [];
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
        attachments: "[]",
        lastGeneratedDate: null,
        generationCount: 0,
        visibilityOffsetMinutes: 60,
        autoArchive: true,
        timezoneOffsetMinutes: 0,
        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          insertedValues.push(values);
          return { onConflictDoNothing: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        }),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    };
    drizzleMock.mockReturnValue(db);

    await runEventInstanceGenerationCron({ DB: {} } as never);

    expect(insertedValues.length).toBeGreaterThan(0);
    expect(insertedValues).toContainEqual(expect.objectContaining({
      autoArchive: true,
    }));
    for (const val of insertedValues) {
      expect(val).not.toHaveProperty("visibleAt");
    }
  });

  it("delays instance creation until now >= start - offset", async () => {
    vi.useFakeTimers();
    // now is 2026-05-04T07:00Z, next occurrence is 2026-05-04T10:00Z, offset is 120min
    // creation threshold: 2026-05-04T08:00Z — now is before that, so no instance
    vi.setSystemTime(new Date("2026-05-04T07:00:00.000Z"));
    const insertedValues: unknown[] = [];
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
        attachments: "[]",
        lastGeneratedDate: "2026-05-03",
        generationCount: 1,
        visibilityOffsetMinutes: 120,
        autoArchive: false,
        timezoneOffsetMinutes: 0,
        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(templates) })) })),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          insertedValues.push(values);
          return { onConflictDoNothing: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        }),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    };
    drizzleMock.mockReturnValue(db);

    await runEventInstanceGenerationCron({ DB: {} } as never);

    expect(insertedValues).toHaveLength(0);
  });
});
