import { describe, expect, it, vi } from "vitest";
import { buildReplaceMediaRefsStatements, extractAnnouncementImageNodeKeys } from "../media-references";

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
