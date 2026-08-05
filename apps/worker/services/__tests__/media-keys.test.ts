import { describe, expect, it, vi } from "vitest";
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
  assertContentMediaKey,
  parseMediaKey,
} from "../media-keys";
import { protectContentMediaBucket } from "../media";

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

  it("allows only canonical content keys through the delete gate", () => {
    expect(assertContentMediaKey(buildEventImageKey("event-1", "image/webp", OBJECT_ID))).toMatchObject({
      kind: "event_image",
      entityId: "event-1",
    });
    expect(() => assertContentMediaKey("audit-archive/2026/manifest.json")).toThrow(/audit archive/);
    expect(() => assertContentMediaKey("misc/free-form.json")).toThrow(/unrecognized/);
  });

  it("blocks archive and unknown keys before content R2 put or delete", async () => {
    const put = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);
    const bucket = protectContentMediaBucket({ put, delete: remove } as unknown as R2Bucket);
    const canonical = buildEventImageKey("event-1", "image/webp", OBJECT_ID);

    await bucket.put(canonical, new Uint8Array([1]));
    expect(put).toHaveBeenCalledWith(canonical, expect.any(Uint8Array));

    expect(() => bucket.put("audit-archive/2026/manifest.json", new Uint8Array([1]))).toThrow(/audit archive/);
    expect(() => bucket.put("misc/free-form.json", new Uint8Array([1]))).toThrow(/unrecognized/);
    await expect(bucket.delete("audit-archive/2026/manifest.json")).rejects.toThrow(/audit archive/);
    expect(remove).not.toHaveBeenCalled();
  });
});
