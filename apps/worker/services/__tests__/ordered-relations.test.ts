import { describe, expect, it, vi } from "vitest";
import {
  availabilityFromStorage,
  buildReplaceMemberAvailabilityStatements,
  loadMemberAvailabilityWindows,
  loadMemberClasses,
} from "../ordered-relations";

describe("ordered relation D1 parameter limits", () => {
  it("chunks owner lookups below 100 bindings and merges ordered rows", async () => {
    const prepared: Array<{ sql: string; bindings: string[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: string[]) => {
          prepared.push({ sql, bindings });
          return {
            all: vi.fn().mockResolvedValue({
              results: bindings.flatMap((ownerId) => ownerId === "owner-0"
                ? [
                    { owner_id: ownerId, value: "class-a" },
                    { owner_id: ownerId, value: "class-b" },
                  ]
                : [{ owner_id: ownerId, value: `class-${ownerId}` }]),
            }),
          };
        },
      })),
    };
    const ownerIds = Array.from({ length: 101 }, (_, index) => `owner-${index}`);

    const relations = await loadMemberClasses(db as unknown as D1Database, ownerIds);

    expect(prepared).toHaveLength(3);
    expect(prepared.every(({ bindings }) => bindings.length < 100)).toBe(true);
    expect(relations).toHaveLength(101);
    expect(relations.get("owner-0")).toEqual(["class-a", "class-b"]);
    expect(relations.get("owner-100")).toEqual(["class-owner-100"]);
  });
});

describe("member availability relations", () => {
  it("loads explicit availability window columns", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({
            results: [
              { user_id: "u-1", weekday: 1, start_minute: 540, end_minute: 600 },
              { user_id: "u-1", weekday: 5, start_minute: 1320, end_minute: 1440 },
            ],
          }),
        })),
      })),
    };

    const rows = await loadMemberAvailabilityWindows(db as unknown as D1Database, ["u-1"]);

    expect(rows.get("u-1")).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 600 },
      { weekday: 5, startMinute: 1320, endMinute: 1440 },
    ]);
    expect(availabilityFromStorage("UTC", rows.get("u-1") ?? [])?.days.monday).toEqual([
      { start_utc: "09:00", end_utc: "10:00" },
    ]);
  });

  it("splits cross-midnight API ranges into normalized insert statements", () => {
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...bindings: unknown[]) => {
          const statement = { sql, bindings };
          prepared.push(statement);
          return statement;
        }),
      })),
    };

    buildReplaceMemberAvailabilityStatements(db as unknown as D1Database, "u-1", {
      timezone: "UTC",
      days: {
        sunday: [],
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [{ start_utc: "22:00", end_utc: "01:00" }],
        saturday: [],
      },
    });

    expect(prepared).toHaveLength(3);
    expect(prepared[0]).toMatchObject({ bindings: ["u-1"] });
    expect(prepared[1]).toMatchObject({ bindings: ["u-1", 5, 1320, 1440] });
    expect(prepared[2]).toMatchObject({ bindings: ["u-1", 6, 0, 60] });
    expect(prepared.map(({ sql }) => sql).join("\n")).not.toMatch(/json_/i);
  });

  it("clears rows for null and rejects orphaned rows without a timezone", () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
      })),
    };

    expect(buildReplaceMemberAvailabilityStatements(
      db as unknown as D1Database,
      "u-1",
      null,
    )).toHaveLength(1);
    expect(() => availabilityFromStorage(null, [
      { weekday: 1, startMinute: 540, endMinute: 600 },
    ])).toThrow("require an availability timezone");
  });
});
