import { describe, expect, it, vi } from "vitest";
import {
  AnnouncementImageStagingService,
  signAnnouncementImageStagingToken,
  verifyAnnouncementImageStagingToken,
} from "../announcement-image-staging";

const ID = "Abcdefghijklmnopqrstu";
const NOW = new Date("2026-07-28T12:00:00.000Z");

function rawDb(existing: { id: string } | null = null) {
  const first = vi.fn().mockResolvedValue(existing);
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })), first } as unknown as D1Database;
}

describe("announcement image staging tokens", () => {
  it("uses a real HMAC and rejects forged, cross-actor, and expired tokens", async () => {
    const valid = await signAnnouncementImageStagingToken("secret", { version: 1, purpose: "announcement-image-staging", announcement_id: ID, actor_id: "actor-1", exp: Math.floor(NOW.getTime() / 1000) + 60 });
    expect(await verifyAnnouncementImageStagingToken("secret", valid, "actor-1", NOW)).toMatchObject({ announcement_id: ID });
    expect(await verifyAnnouncementImageStagingToken("secret", `${valid}x`, "actor-1", NOW)).toBeNull();
    expect(await verifyAnnouncementImageStagingToken("secret", valid, "actor-2", NOW)).toBeNull();
    const expired = await signAnnouncementImageStagingToken("secret", { version: 1, purpose: "announcement-image-staging", announcement_id: ID, actor_id: "actor-1", exp: Math.floor(NOW.getTime() / 1000) });
    expect(await verifyAnnouncementImageStagingToken("secret", expired, "actor-1", NOW)).toBeNull();
  });

  it("writes only to the announcement reservation prefix and never writes the database", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const db = rawDb();
    const service = new AnnouncementImageStagingService({ media: { put, delete: vi.fn(), list: vi.fn().mockResolvedValue({ objects: [] }) } as unknown as R2Bucket, rawDb: db, signingSecret: "secret", now: () => NOW, generateId: () => ID });

    const result = await service.stage("actor-1", [{ data: new Uint8Array([1]).buffer, contentType: "image/png" }], undefined, 5);

    expect(result).toMatchObject({ ok: true, data: { staging_id: ID } });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^announcement/${ID}/images/`)), expect.any(ArrayBuffer), expect.anything());
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).toHaveBeenCalledTimes(1);
  });

  it("removes every attempted staging key when a later R2 write fails", async () => {
    const failure = new Error("second R2 upload failed");
    const put = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const service = new AnnouncementImageStagingService({
      media: { put, delete: deleteObject, list: vi.fn().mockResolvedValue({ objects: [] }) } as unknown as R2Bucket,
      rawDb: rawDb(),
      signingSecret: "secret",
      now: () => NOW,
      generateId: () => ID,
    });

    await expect(service.stage("actor-1", [
      { data: new Uint8Array([1]).buffer, contentType: "image/png" },
      { data: new Uint8Array([2]).buffer, contentType: "image/png" },
    ], undefined, 5)).rejects.toBe(failure);

    expect(deleteObject).toHaveBeenCalledTimes(2);
  });
});
