import { describe, expect, it, vi } from "vitest";
import { loadMemberClasses } from "../ordered-relations";

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
