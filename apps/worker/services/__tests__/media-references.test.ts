import { describe, expect, it, vi } from "vitest";
import {
  buildReplaceMediaRefsStatements,
  deleteMediaRefsBulk,
  extractAnnouncementImageNodeKeys,
  findUnreferencedKeys,
} from "../media-references";

describe("announcement media references", () => {
  it("extracts encoded TipTap image endpoint URLs but ignores ordinary strings", () => {
    const id = "Abcdefghijklmnopqrstu";
    const key = `announcement/${id}/images/a.png`;
    const body = JSON.stringify({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: key }] },
      { type: "image", attrs: { src: `/api/announcements/image?key=${encodeURIComponent(key)}` } },
    ] });
    expect(extractAnnouncementImageNodeKeys(body, id)).toEqual([key]);
  });

  it("builds one delete and one insert statement per unique reference", () => {
    const bind = vi.fn(() => ({}));
    const prepare = vi.fn(() => ({ bind }));
    const statements = buildReplaceMediaRefsStatements({ prepare } as unknown as D1Database, "announcement", "a-1", ["one", "one", "two"]);
    expect(statements).toHaveLength(3);
    expect(prepare).toHaveBeenCalledTimes(3);
  });
});

describe("media reference D1 parameter limits", () => {
  it("keeps entity-id IN lists at 50 parameters", async () => {
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => {
          prepared.push({ sql, bindings });
          return {};
        },
      })),
      batch: vi.fn().mockResolvedValue([]),
    };

    await deleteMediaRefsBulk(db as unknown as D1Database, "gallery_item", Array.from({ length: 121 }, (_, index) => `id-${index}`));

    expect(prepared).toHaveLength(3);
    expect(prepared.every(({ bindings }) => bindings.slice(1).length <= 50)).toBe(true);
  });

  it("keeps media-key IN lookups at 50 parameters", async () => {
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => {
          prepared.push({ sql, bindings });
          return { all: vi.fn().mockResolvedValue({ results: [] }) };
        },
      })),
    };

    const keys = Array.from({ length: 121 }, (_, index) => `gallery/users/uploader/items/item-${index}/images/a.webp`);
    expect(await findUnreferencedKeys(db as unknown as D1Database, keys)).toEqual(keys);
    expect(prepared).toHaveLength(3);
    expect(prepared.every(({ bindings }) => bindings.length <= 50)).toBe(true);
  });
});
