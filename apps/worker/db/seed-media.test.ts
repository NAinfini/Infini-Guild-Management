import { describe, expect, it, vi } from "vitest";
import { readWebPDimensions } from "../services/MediaService";
import { clearLocalMediaObjects, SEEDED_MEDIA_IDS, seedLocalMedia } from "./seed-media";

type CapturedStatement = { sql: string; values: unknown[] };

const seedInput = {
  adminUserId: "admin-user",
  avatarUserIds: Array.from({ length: 6 }, (_, index) => `avatar-user-${index + 1}`),
  profileImageUserIds: Array.from({ length: 3 }, (_, index) => `profile-user-${index + 1}`),
  profileAudioUserId: "audio-user",
  galleryImages: Array.from({ length: 4 }, (_, index) => ({
    id: `gallery-item-${index + 1}`,
    ownerUserId: `gallery-owner-${index + 1}`,
  })),
  classId: "class-image",
};

function fakeDb(batchResult: Promise<unknown> = Promise.resolve([])) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: unknown[]): CapturedStatement => ({ sql, values }),
  }));
  const batch = vi.fn((_statements: readonly unknown[]) => batchResult);
  return { DB: { prepare, batch } as unknown as D1Database, prepare, batch };
}

function fakeBucket() {
  const put = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false });
  return {
    MEDIA: { put, delete: del, list } as unknown as R2Bucket,
    put,
    delete: del,
    list,
  };
}

function allSeededMediaIds(): string[] {
  return [
    ...SEEDED_MEDIA_IDS.avatars,
    ...SEEDED_MEDIA_IDS.profileImages,
    ...SEEDED_MEDIA_IDS.galleryImages,
    SEEDED_MEDIA_IDS.classIcon,
    SEEDED_MEDIA_IDS.siteLogo,
    SEEDED_MEDIA_IDS.profileAudio,
  ];
}

describe("local seeded media", () => {
  it("writes valid canonical R2 objects before one authoritative D1 batch", async () => {
    const db = fakeDb();
    const bucket = fakeBucket();

    await seedLocalMedia({
      DB: db.DB,
      MEDIA: bucket.MEDIA,
      ENVIRONMENT: "development",
    } as never, seedInput);

    const ids = allSeededMediaIds();
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{21}$/.test(id))).toBe(true);

    const objectKeys = bucket.put.mock.calls.map(([key]) => key as string);
    expect(objectKeys).toHaveLength(31);
    expect(new Set(objectKeys).size).toBe(objectKeys.length);
    expect(objectKeys.filter((key) => key.endsWith(".webp"))).toHaveLength(30);
    expect(objectKeys.filter((key) => key.endsWith(".ogg"))).toEqual([
      `media/${SEEDED_MEDIA_IDS.profileAudio}/full.ogg`,
    ]);
    expect(objectKeys.every((key) => (
      /^media\/[A-Za-z0-9_-]{21}\/(?:full|view)\.webp$/.test(key)
      || /^media\/[A-Za-z0-9_-]{21}\/full\.ogg$/.test(key)
    ))).toBe(true);

    for (const [key, data, options] of bucket.put.mock.calls) {
      const bytes = data as Uint8Array;
      if ((key as string).endsWith(".webp")) {
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
        expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
        const dimensions = readWebPDimensions(bytes.buffer as ArrayBuffer);
        expect(dimensions.width).toBeGreaterThan(0);
        expect(dimensions.height).toBeGreaterThan(0);
        expect(options).toEqual({ httpMetadata: { contentType: "image/webp" } });
      } else {
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("OggS");
        expect(new TextDecoder().decode(bytes)).toContain("OpusHead");
        expect(options).toEqual({ httpMetadata: { contentType: "audio/ogg" } });
      }
    }

    expect(db.batch).toHaveBeenCalledTimes(1);
    const statements = db.batch.mock.calls[0]![0] as unknown as CapturedStatement[];
    const assets = statements.filter(({ sql }) => sql.includes("INSERT INTO media_assets"));
    const variants = statements.filter(({ sql }) => sql.includes("INSERT INTO media_variants"));
    const readyUpdates = statements.filter(({ sql }) => sql.includes("UPDATE media_assets"));
    const links = statements.filter(({ sql }) => sql.includes("INSERT INTO media_links"));
    expect(assets).toHaveLength(16);
    expect(variants).toHaveLength(31);
    expect(readyUpdates).toHaveLength(16);
    expect(links).toHaveLength(16);
    expect(new Set(assets.map(({ values }) => values[0]))).toEqual(new Set(ids));
    expect(new Set(variants.map(({ values }) => {
      const [mediaId, variant] = values;
      const extension = mediaId === SEEDED_MEDIA_IDS.profileAudio ? "ogg" : "webp";
      return `media/${mediaId}/${variant}.${extension}`;
    }))).toEqual(new Set(objectKeys));
    for (const { values } of variants) {
      const [mediaId, variant, byteSize, width, height] = values;
      const extension = mediaId === SEEDED_MEDIA_IDS.profileAudio ? "ogg" : "webp";
      const object = bucket.put.mock.calls.find(([key]) => (
        key === `media/${mediaId}/${variant}.${extension}`
      ));
      expect(object).toBeDefined();
      const bytes = object![1] as Uint8Array;
      expect(byteSize).toBe(bytes.byteLength);
      if (extension === "webp") {
        expect({ width, height }).toEqual(readWebPDimensions(bytes.buffer as ArrayBuffer));
      } else {
        expect(width).toBeNull();
        expect(height).toBeNull();
      }
    }
    expect(assets.every(({ sql }) => sql.includes("'pending'") && sql.includes("'+1 day'"))).toBe(true);
    expect(readyUpdates.every(({ sql }) => (
      sql.includes("SET state = 'ready', expires_at = NULL")
      && sql.includes("state = 'pending'")
    ))).toBe(true);
    expect(statements.indexOf(assets.at(-1)!)).toBeLessThan(statements.indexOf(variants[0]!));
    expect(statements.indexOf(variants.at(-1)!)).toBeLessThan(statements.indexOf(readyUpdates[0]!));
    expect(statements.indexOf(readyUpdates.at(-1)!)).toBeLessThan(statements.indexOf(links[0]!));
    expect(links.map(({ values }) => values[3])).toEqual([
      ...Array(6).fill("avatar"),
      ...Array(3).fill("image"),
      ...Array(4).fill("image"),
      "icon",
      "logo",
      "audio",
    ]);
    expect(Math.max(...bucket.put.mock.invocationCallOrder))
      .toBeLessThan(db.batch.mock.invocationCallOrder[0]!);
  });

  it("removes the exact seeded keys when the D1 batch fails", async () => {
    const failure = new Error("D1 batch failed");
    const db = fakeDb(Promise.reject(failure));
    const bucket = fakeBucket();

    await expect(seedLocalMedia({
      DB: db.DB,
      MEDIA: bucket.MEDIA,
      ENVIRONMENT: "development",
    } as never, seedInput)).rejects.toBe(failure);

    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(new Set(bucket.delete.mock.calls[0]![0] as string[])).toEqual(
      new Set(bucket.put.mock.calls.map(([key]) => key as string)),
    );
  });

  it("clears only the local content-media prefix and rejects production", async () => {
    const db = fakeDb();
    const bucket = fakeBucket();
    bucket.list
      .mockResolvedValueOnce({ objects: [{ key: "media/one/full.webp" }], truncated: true, cursor: "next" })
      .mockResolvedValueOnce({ objects: [{ key: "media/two/full.ogg" }], truncated: false });

    await clearLocalMediaObjects({
      DB: db.DB,
      MEDIA: bucket.MEDIA,
      ENVIRONMENT: "development",
    } as never);

    expect(bucket.list).toHaveBeenNthCalledWith(1, { prefix: "media/", limit: 1_000 });
    expect(bucket.list).toHaveBeenNthCalledWith(2, { prefix: "media/", limit: 1_000, cursor: "next" });
    expect(bucket.delete).toHaveBeenCalledWith([
      "media/one/full.webp",
      "media/two/full.ogg",
    ]);

    const productionBucket = fakeBucket();
    await expect(clearLocalMediaObjects({
      DB: db.DB,
      MEDIA: productionBucket.MEDIA,
      ENVIRONMENT: "production",
    } as never)).rejects.toThrow("only in development");
    await expect(seedLocalMedia({
      DB: db.DB,
      MEDIA: productionBucket.MEDIA,
      ENVIRONMENT: "production",
    } as never, seedInput)).rejects.toThrow("only in development");
    expect(productionBucket.list).not.toHaveBeenCalled();
    expect(productionBucket.put).not.toHaveBeenCalled();
    expect(productionBucket.delete).not.toHaveBeenCalled();
  });
});
