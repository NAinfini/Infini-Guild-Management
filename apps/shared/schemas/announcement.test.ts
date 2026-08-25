import { describe, expect, it } from "vitest";
import {
  announcementAttachmentUploadResponseSchema,
  announcementSchema,
  announcementSummarySchema,
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
      attachment_media_ids: [],
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

  it("allows an update to clear a publication time without widening create input", () => {
    expect(updateAnnouncementSchema.parse({ publish_at: null })).toEqual({ publish_at: null });
    expect(
      createAnnouncementSchema.safeParse({
        title: "Maintenance",
        body_json: '{"type":"doc","content":[]}',
        publish_at: null,
      }).success,
    ).toBe(false);
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

  it("keeps list summaries body-free while detail carries author and ordered attachments", () => {
    const summary = {
      id: "announcement-1",
      title: "Maintenance",
      pinned: true,
      status: "published",
      publish_at: "2026-07-29T00:00:00.000Z",
      expires_at: null,
      archived_at: null,
      created_by: "author-1",
      updated_by: null,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
      author: { id: "author-1", display_name: "Guild Master", avatar_media_id: null },
    };
    expect(announcementSummarySchema.parse(summary)).toEqual(summary);
    expect(announcementSummarySchema.parse({ ...summary, body_json: "{}" })).toEqual(summary);
    expect(announcementSchema.parse({
      ...summary,
      body_json: '{"type":"doc","content":[]}',
      attachments: [{
        media_id: mediaId,
        name: "guide.pdf",
        content_type: "application/pdf",
        byte_size: 1024,
      }],
    }).attachments[0]?.name).toBe("guide.pdf");
  });

  it("validates staged attachment metadata", () => {
    expect(announcementAttachmentUploadResponseSchema.parse({
      expires_at: "2026-07-29T00:00:00.000Z",
      attachment: {
        media_id: mediaId,
        name: "schedule.xlsx",
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        byte_size: 2048,
      },
    }).attachment.name).toBe("schedule.xlsx");
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
