import { describe, expect, it } from "vitest";
import {
  buildAnnouncementImageKey,
  buildClassIconKey,
  buildEventImageKey,
  buildGalleryImageKey,
  buildGalleryUserPrefix,
  buildMemberAudioKey,
  buildMemberImageKey,
  buildSiteLogoKey,
  buildStorageItemImageKey,
  buildWikiImageKey,
  parseMediaKey,
} from "../media-keys";

const OBJECT_ID = "018f47ac-18c2-7ddf-9f0b-1a2b3c4d5e6f";

describe("canonical media keys", () => {
  it("derives extensions from validated MIME and never from client filenames", () => {
    expect(buildMemberImageKey("user-1", "image/png", OBJECT_ID)).toBe(`members/user-1/images/${OBJECT_ID}.png`);
    expect(buildMemberAudioKey("user-1", "audio/ogg", OBJECT_ID)).toBe(`members/user-1/audio/${OBJECT_ID}.ogg`);
    expect(buildSiteLogoKey("image/avif", OBJECT_ID)).toBe(`site/logo/${OBJECT_ID}.avif`);
    expect(buildGalleryUserPrefix("user/1")).toBe("gallery/users/user%2F1/items/");
    expect(buildGalleryImageKey("user/1", "item/1", "image/jpeg", OBJECT_ID)).toBe(`gallery/users/user%2F1/items/item%2F1/images/${OBJECT_ID}.jpg`);
    expect(buildEventImageKey("event-1", "image/webp", OBJECT_ID)).toBe(`events/event-1/images/${OBJECT_ID}.webp`);
    expect(buildAnnouncementImageKey("announcement-1", "image/gif", OBJECT_ID)).toBe(`announcement/announcement-1/images/${OBJECT_ID}.gif`);
    expect(buildWikiImageKey("article-1", "image/png", OBJECT_ID)).toBe(`wiki/article-1/images/${OBJECT_ID}.png`);
    expect(buildStorageItemImageKey("item-1", "image/webp", OBJECT_ID)).toBe(`storage/items/item-1/${OBJECT_ID}.webp`);
  });

  it("round-trips encoded entity ids through one strict parser", () => {
    const key = buildClassIconKey("storm/caller", "image/webp", OBJECT_ID);
    expect(key).toBe(`class-icons/storm%2Fcaller/${OBJECT_ID}.webp`);
    expect(parseMediaKey(key)).toEqual({ kind: "class_icon", entityId: "storm/caller", contentType: "image/webp" });

    const galleryKey = buildGalleryImageKey("user/1", "item/1", "image/webp", OBJECT_ID);
    expect(parseMediaKey(galleryKey)).toEqual({ kind: "gallery_image", entityId: "item/1", contentType: "image/webp" });
  });

  it("rejects traversal, extra path segments, and non-random leaves", () => {
    expect(parseMediaKey("events/../images/a.webp")).toBeNull();
    expect(parseMediaKey("events/event-1/images/folder/a.webp")).toBeNull();
    expect(parseMediaKey("events/event-1/images/original file.png")).toBeNull();
    expect(parseMediaKey(`gallery/users/../items/item-1/images/${OBJECT_ID}.webp`)).toBeNull();
  });
});
