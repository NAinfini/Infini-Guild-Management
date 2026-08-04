import { describe, expect, it } from "vitest";
import {
  announcementImageStagingResponseSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "./announcement";
import { createWikiArticleSchema, updateWikiArticleSchema } from "./wiki";

const stagingToken = "signed-announcement-staging-token".repeat(3);

describe("announcement staging contracts", () => {
  it("allows a create request to claim an image staging token", () => {
    expect(
      createAnnouncementSchema.parse({
        title: "Maintenance",
        body_json: '{"type":"doc","content":[]}',
        staging_token: stagingToken,
      }),
    ).toMatchObject({
      staging_token: stagingToken,
      pinned: false,
      status: "draft",
    });
  });

  it("never applies create defaults or staging fields to an update", () => {
    expect(
      updateAnnouncementSchema.parse({
        title: "Updated",
        staging_token: stagingToken,
      }),
    ).toEqual({ title: "Updated" });
  });

  it("validates the staging upload response", () => {
    expect(
      announcementImageStagingResponseSchema.parse({
        staging_id: "nanoid1234567890abcde",
        staging_token: stagingToken,
        expires_at: "2026-07-29T00:00:00.000Z",
        keys: ["announcement/nanoid1234567890abcde/images/image-1"],
      }),
    ).toMatchObject({
      staging_id: "nanoid1234567890abcde",
      staging_token: stagingToken,
    });
  });

  it("rejects malformed staging response IDs and short tokens", () => {
    expect(
      announcementImageStagingResponseSchema.safeParse({
        staging_id: "../announcement",
        staging_token: "short",
        expires_at: "2026-07-29T00:00:00.000Z",
        keys: [],
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
