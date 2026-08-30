import { describe, expect, it } from "vitest";
import {
  announcementAttachmentUploadResponseSchema,
  announcementEtag,
  announcementSchema,
  announcementSummarySchema,
  announcementImageUploadResponseSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "./announcement";
import { createWikiArticleSchema, updateWikiArticleSchema } from "./wiki";

const mediaId = "media1234567890abcdef";

describe("announcement contracts", () => {
  it("derives one stable aggregate ETag from the announcement revision", () => {
    expect(announcementEtag({
      id: "announcement-1",
      updated_at: "2026-08-09T12:00:00.000Z",
    })).toBe('"announcement-announcement-1-2026-08-09T12:00:00.000Z"');
  });

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
      category: "announcement",
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
      category: "announcement",
      pinned: true,
      view_count: 12,
      status: "published",
      publish_at: "2026-07-29T00:00:00.000Z",
      expires_at: null,
      archived_at: null,
      created_by: "author-1",
      updated_by: null,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
      excerpt: "Planned maintenance starts after guild war.",
      preview_media_id: null,
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
        name: "strategy.guildpack",
        content_type: "application/octet-stream",
        byte_size: 2048,
      },
    }).attachment.name).toBe("strategy.guildpack");
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

  it("rejects a hand-crafted opener link in announcement and wiki API payloads", () => {
    const body_json = JSON.stringify({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Unsafe link",
          marks: [{
            type: "link",
            attrs: {
              href: "https://external.example/guide",
              target: "_blank",
              rel: "opener",
              class: null,
            },
          }],
        }],
      }],
    });

    expect(createAnnouncementSchema.safeParse({ title: "Unsafe", body_json }).success).toBe(false);
    expect(createWikiArticleSchema.safeParse({
      title: "Unsafe",
      category_id: "category-1",
      body_json,
    }).success).toBe(false);
  });
});
