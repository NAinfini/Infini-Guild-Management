import { describe, expect, it, vi } from "vitest";
import { SearchService } from "../SearchService";

function createDb(rowsBySelect: unknown[][] = []) {
  const limits: number[] = [];
  const whereFilters: unknown[] = [];
  let selectIndex = 0;
  const db = {
    select: vi.fn(() => {
      const rows = rowsBySelect[selectIndex++] ?? [];
      const builder = {
        from: vi.fn(() => builder),
        leftJoin: vi.fn(() => builder),
        where: vi.fn((filter: unknown) => {
          whereFilters.push(filter);
          return builder;
        }),
        orderBy: vi.fn(() => builder),
        limit: vi.fn((limit: number) => {
          limits.push(limit);
          return Promise.resolve(rows);
        }),
      };
      return builder;
    }),
  };
  return { db, limits, whereFilters };
}

describe("SearchService", () => {
  it("returns empty results for short queries without querying the database", async () => {
    const { db } = createDb();
    const service = new SearchService(db as never);

    const result = await service.search({ query: " a ", limit: "50" });

    expect(result).toEqual({ ok: true, data: { data: [] } });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("caps the public limit and keeps deterministic cross-type ordering", async () => {
    const rows = [
      Array.from({ length: 10 }, (_, index) => ({ id: `user-${index}`, username: `User ${index}`, role: "member", power: index + 1 })),
      Array.from({ length: 10 }, (_, index) => ({ id: `event-${index}`, title: `Event ${index}`, type: "raid", startAt: "2026-03-08T12:00:00.000Z" })),
      Array.from({ length: 10 }, (_, index) => ({ id: `announcement-${index}`, title: `Announcement ${index}` })),
      Array.from({ length: 10 }, (_, index) => ({ id: `wiki-${index}`, title: `Wiki ${index}`, slug: `wiki-${index}` })),
      Array.from({ length: 10 }, (_, index) => ({ id: `gallery-${index}`, type: "image", caption: `Gallery ${index}` })),
      Array.from({ length: 10 }, (_, index) => ({ id: `war-${index}`, warName: `War ${index}`, enemyName: index === 0 ? "Enemy" : null })),
    ];
    const { db, limits } = createDb(rows);
    const service = new SearchService(db as never);

    const result = await service.search({ query: "guild", limit: "999" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data).toHaveLength(50);
    expect(result.data.data.map((item) => item.type).slice(0, 12)).toEqual([
      "user", "user", "user", "user", "user", "user", "user", "user", "user", "user", "event", "event",
    ]);
    expect(result.data.data[0]).toEqual(expect.objectContaining({
      id: "user-0",
      title: "User 0",
      subtitle: "member · 1 power",
      type: "user",
      to: "/roster",
      entity_id: "user-0",
      role: "member",
    }));
    expect(result.data.data[10]).toEqual(expect.objectContaining({
      id: "event-0",
      title: "Event 0",
      subtitle: "raid · 3/8/2026",
      type: "event",
      to: "/events",
      entity_id: "event-0",
    }));
    expect(limits).toEqual([17, 17, 17, 17, 17, 17]);
  });

  it("uses the default limit for invalid limit input", async () => {
    const { db, limits } = createDb([[], [], [], [], [], []]);
    const service = new SearchService(db as never);

    const result = await service.search({ query: "guild", limit: "0" });

    expect(result).toEqual({ ok: true, data: { data: [] } });
    expect(limits).toEqual([8, 8, 8, 8, 8, 8]);
  });

  it("filters future-visible events out of public search", async () => {
    function collectColumnNames(value: unknown): string[] {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const names = typeof record.name === "string" ? [record.name] : [];
      const chunks = Array.isArray(record.queryChunks)
        ? record.queryChunks.flatMap(collectColumnNames)
        : [];
      return [...names, ...chunks];
    }

    const { db, whereFilters } = createDb([[], [], [], [], [], []]);
    const service = new SearchService(db as never);

    await service.search({ query: "guild" });

    expect(whereFilters).toHaveLength(6);
    expect(collectColumnNames(whereFilters[1])).toContain("visible_at");
  });
});
