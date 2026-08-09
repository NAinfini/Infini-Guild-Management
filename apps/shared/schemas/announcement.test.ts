import { describe, expect, it } from "vitest";
import {
  announcementImageUploadResponseSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "./announcement";
import { createWikiArticleSchema, updateWikiArticleSchema } from "./wiki";

const mediaId = "media1234567890abcdef";

describe("announcement contracts", () => {
  it("applies create defaults without accepting upload-owned media fields", () => {
    expect(
      createAnnouncementSchema.parse({
        title: "Maintenance",
        body_json: '{"type":"doc","content":[]}',
        media_ids: [mediaId],
      }),
    ).toEqual({
      title: "Maintenance",
      body_json: '{"type":"doc","content":[]}',
      pinned: false,
      status: "draft",
    });
  });

  it("never applies create defaults or upload-owned media fields to an update", () => {
    expect(
      updateAnnouncementSchema.parse({
        title: "Updated",
        media_ids: [mediaId],
      }),
    ).toEqual({ title: "Updated" });
  });

  it("validates the pending image upload response", () => {
    expect(
      announcementImageUploadResponseSchema.parse({
        expires_at: "2026-07-29T00:00:00.000Z",
        media_ids: [mediaId],
      }),
    ).toEqual({
      expires_at: "2026-07-29T00:00:00.000Z",
      media_ids: [mediaId],
    });
  });

  it("rejects malformed media IDs", () => {
    expect(
      announcementImageUploadResponseSchema.safeParse({
        expires_at: "2026-07-29T00:00:00.000Z",
        media_ids: ["../announcement"],
      }).success,
    ).toBe(false);
  });

  it.each(["not-json", "[]", "null", "42", '"text"'])(
    "rejects non-object announcement body JSON: %s",
    (body_json) => {
      expect(createAnnouncementSchema.safeParse({ title: "Invalid", body_json }).success).toBe(false);
      expect(updateAnnouncementSchema.safeParse({ body_json }).success).toBe(false);
    },
  );

  it.each(["not-json", "[]", "null", "42", '"text"'])(
    "rejects non-object wiki body JSON: %s",
    (body_json) => {
      expect(createWikiArticleSchema.safeParse({
        title: "Invalid",
        category_id: "category-1",
        body_json,
      }).success).toBe(false);
      expect(updateWikiArticleSchema.safeParse({ body_json }).success).toBe(false);
    },
  );
});
