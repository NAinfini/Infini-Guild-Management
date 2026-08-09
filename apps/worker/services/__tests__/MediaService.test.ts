import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@guild/shared";

const MEDIA_ID = "Abcdefghijklmnopqrstu";
const MEDIA_ID_TWO = "Vbcdefghijklmnopqrstu";

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => MEDIA_ID) }));

import { nanoid } from "nanoid";

import {
  extractRichTextMediaIds,
  MediaService,
  MediaValidationError,
  parseImageMediaFormData,
  readWebPDimensions,
} from "../MediaService";
import {
  buildMediaKey,
  requiredMediaVariants,
  type MediaEntityType,
  type MediaLinkSlot,
  type MediaPurpose,
} from "../media-keys";

type Method = "first" | "all" | "run";
type Resolver = (method: Method, sql: string, bindings: unknown[]) => unknown;
type RecordedStatement = { sql: string; bindings: unknown[] };

function fakeDb(resolver: Resolver = () => null) {
  const statements: RecordedStatement[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      const statement = {
        sql,
        bindings,
        first: vi.fn(async () => resolver("first", sql, bindings)),
        all: vi.fn(async () => resolver("all", sql, bindings) ?? { results: [] }),
        run: vi.fn(async () => resolver("run", sql, bindings) ?? { meta: { changes: 1 } }),
      };
      statements.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (batchStatements: RecordedStatement[]) => batchStatements.map(() => ({
    success: true,
    results: [],
    meta: { changes: 1 },
  })));
  return { db: { prepare, batch } as unknown as D1Database, statements, prepare, batch };
}

function fakeBucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
  } as unknown as R2Bucket & {
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
}

function webp(chunks: Array<{ kind: string; payload: Uint8Array }>): ArrayBuffer {
  const chunkBytes = chunks.reduce((sum, chunk) => sum + 8 + chunk.payload.length + (chunk.payload.length & 1), 0);
  const bytes = new Uint8Array(12 + chunkBytes);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(new TextEncoder().encode(chunk.kind), offset);
    new DataView(bytes.buffer).setUint32(offset + 4, chunk.payload.length, true);
    bytes.set(chunk.payload, offset + 8);
    offset += 8 + chunk.payload.length + (chunk.payload.length & 1);
  }
  return bytes.buffer;
}

function vp8(width: number, height: number): ArrayBuffer {
  const payload = new Uint8Array(10);
  payload.set([0x9d, 0x01, 0x2a], 3);
  const view = new DataView(payload.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return webp([{ kind: "VP8 ", payload }]);
}

function vp8l(width: number, height: number): ArrayBuffer {
  const w = width - 1;
  const h = height - 1;
  const payload = new Uint8Array([
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
  ]);
  return webp([{ kind: "VP8L", payload }]);
}

function vp8x(width: number, height: number, animated = false): ArrayBuffer {
  const canvas = new Uint8Array(10);
  canvas[0] = animated ? 0x02 : 0;
  const w = width - 1;
  const h = height - 1;
  canvas.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 4);
  canvas.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 7);
  const image = new Uint8Array(new Uint8Array(vp8(Math.min(width, 16_000), Math.min(height, 16_000))).slice(20, 30));
  return webp([{ kind: "VP8X", payload: canvas }, { kind: "VP8 ", payload: image }]);
}

function imageForm(full: ArrayBuffer, view: ArrayBuffer): FormData {
  const form = new FormData();
  form.append("full", new File([full], "full.webp", { type: "image/webp" }));
  form.append("view", new File([view], "view.webp", { type: "image/webp" }));
  return form;
}

function oggOpus(): ArrayBuffer {
  const bytes = new Uint8Array(36);
  bytes.set(new TextEncoder().encode("OggS"), 0);
  bytes[26] = 1;
  bytes[27] = 8;
  bytes.set(new TextEncoder().encode("OpusHead"), 28);
  return bytes.buffer;
}

function storedImageVariants(mediaId = MEDIA_ID, width = 4000, height = 3000, viewWidth = 1440, viewHeight = 1080) {
  return [
    {
      media_id: mediaId,
      variant: "full",
      byte_size: 100,
      width,
      height,
    },
    {
      media_id: mediaId,
      variant: "view",
      byte_size: 50,
      width: viewWidth,
      height: viewHeight,
    },
  ];
}

const readyAsset = {
  id: MEDIA_ID,
  owner_user_id: "owner-1",
  purpose: "gallery_image",
  media_type: "image",
  state: "ready",
  expires_at: "2099-01-01T00:00:00.000Z",
} as const;

function readableAsset(purpose: MediaPurpose) {
  return {
    ...readyAsset,
    purpose,
    expires_at: null,
    variant: "view",
  } as const;
}

describe("canonical media contract", () => {
  it("builds opaque nanoid keys with mandatory image variants", () => {
    expect(buildMediaKey(MEDIA_ID, "full", "image")).toBe(`media/${MEDIA_ID}/full.webp`);
    expect(buildMediaKey(MEDIA_ID, "view", "image")).toBe(`media/${MEDIA_ID}/view.webp`);
    expect(buildMediaKey(MEDIA_ID, "full", "audio")).toBe(`media/${MEDIA_ID}/full.ogg`);
    expect(requiredMediaVariants("image")).toEqual(["full", "view"]);
    expect(() => buildMediaKey(MEDIA_ID, "view", "audio")).toThrow(/only the full/);
  });
});

describe("WebP upload validation", () => {
  it("reads VP8, VP8L, and VP8X dimensions", () => {
    expect(readWebPDimensions(vp8(800, 600))).toEqual({ width: 800, height: 600 });
    expect(readWebPDimensions(vp8l(1080, 1920))).toEqual({ width: 1080, height: 1920 });
    expect(readWebPDimensions(vp8x(2400, 1200))).toEqual({ width: 2400, height: 1200 });
  });

  it("parses aligned full/view arrays without retaining image filenames", async () => {
    const parsed = await parseImageMediaFormData(imageForm(vp8(4000, 3000), vp8(1440, 1080)));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.full).toBeInstanceOf(ArrayBuffer);
    expect(parsed[0]?.view).toBeInstanceOf(ArrayBuffer);
    expect(parsed[0]).not.toHaveProperty("originalName");
  });

  it("rejects misaligned multipart fields", async () => {
    const missingView = imageForm(vp8(4000, 3000), vp8(1440, 1080));
    missingView.delete("view");
    await expect(parseImageMediaFormData(missingView)).rejects.toThrow(/aligned/);
  });

  it("enforces animation rejection and exact landscape, portrait, square, and small views in create", async () => {
    const service = new MediaService(fakeDb().db, fakeBucket());
    const create = (full: ArrayBuffer, view: ArrayBuffer) => service.create({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      mediaType: "image",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
      variants: { full, view },
    });
    await expect(create(vp8(4000, 3000), vp8(1440, 1080))).resolves.toEqual({ id: MEDIA_ID });
    await expect(create(vp8(3000, 4000), vp8(1080, 1440))).resolves.toEqual({ id: MEDIA_ID });
    await expect(create(vp8(2000, 2000), vp8(1080, 1080))).resolves.toEqual({ id: MEDIA_ID });
    await expect(create(vp8(800, 600), vp8(800, 600))).resolves.toEqual({ id: MEDIA_ID });
    await expect(create(vp8x(800, 600, true), vp8(800, 600))).rejects.toThrow(/video/);
    await expect(create(vp8(4000, 3000), vp8(1920, 1440))).rejects.toThrow(/exactly match/);
    await expect(create(vp8(800, 600), vp8(400, 300))).rejects.toThrow(/exactly match/);
  });

  it("extracts only exact relative canonical rich-text media URLs", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "image", attrs: { src: `/api/media/${MEDIA_ID}/view` } },
        { type: "image", attrs: { src: `https://evil.example/api/media/${MEDIA_ID}/view` } },
        { type: "image", attrs: { src: `/api/media/${MEDIA_ID}/full` } },
      ],
    });
    expect(extractRichTextMediaIds(body)).toEqual([MEDIA_ID]);
  });
});

describe("MediaService lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nanoid).mockReturnValue(MEDIA_ID);
  });

  it("validates both image variants before writes and stores only derived variant metadata", async () => {
    const { db, batch, statements } = fakeDb();
    const bucket = fakeBucket();
    const service = new MediaService(db, bucket);

    await expect(service.create({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      mediaType: "image",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
      variants: { full: vp8(4000, 3000), view: vp8(1440, 1080) },
    })).resolves.toEqual({ id: MEDIA_ID });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(statements).toHaveLength(3);
    expect(bucket.put).toHaveBeenNthCalledWith(
      1,
      `media/${MEDIA_ID}/full.webp`,
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "image/webp" } },
    );
    expect(bucket.put).toHaveBeenNthCalledWith(
      2,
      `media/${MEDIA_ID}/view.webp`,
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "image/webp" } },
    );
    expect(bucket.put.mock.calls.flat().join(" ")).not.toContain("owner-1");
    expect(bucket.put.mock.calls.flat().join(" ")).not.toContain("family photo");
    expect(statements[0]?.bindings[3]).toBeNull();
    const variantStatements = statements.filter((statement) => statement.sql.includes("INSERT INTO media_variants"));
    expect(variantStatements).toHaveLength(2);
    expect(variantStatements.every((statement) => statement.bindings.length === 5)).toBe(true);
    expect(variantStatements.map((statement) => statement.sql).join("\n")).not.toMatch(/r2_key|content_type/);
  });

  it("performs no write when either image variant is invalid", async () => {
    const { db, batch } = fakeDb();
    const bucket = fakeBucket();
    const service = new MediaService(db, bucket);
    await expect(service.create({
      ownerUserId: "owner-1",
      purpose: "member_avatar",
      mediaType: "image",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
      variants: { full: vp8(800, 600), view: vp8(400, 300) },
    })).rejects.toBeInstanceOf(MediaValidationError);
    expect(batch).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("uses the caller's byte limit for every variant and omits image display names", async () => {
    const { db, batch, statements } = fakeDb();
    const bucket = fakeBucket();
    const service = new MediaService(db, bucket);
    const upload = {
      full: vp8(800, 600),
      view: vp8(800, 600),
    };

    await expect(service.createImages({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      uploads: [upload],
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 1,
    })).rejects.toThrow(/at most 1 bytes/);
    expect(batch).not.toHaveBeenCalled();

    await service.createImages({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      uploads: [upload],
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
    });
    expect(statements.find((statement) => statement.sql.includes("INSERT INTO media_assets"))?.bindings[3]).toBeNull();
  });

  it("stores an original display name only for audio", async () => {
    const { db, statements } = fakeDb();
    const bucket = fakeBucket();

    await expect(new MediaService(db, bucket).createAudio({
      ownerUserId: "owner-1",
      originalName: "  voice-note.ogg  ",
      data: oggOpus(),
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
    })).resolves.toEqual({
      expiresAt: "2026-08-09T00:00:00.000Z",
      mediaId: MEDIA_ID,
    });
    expect(statements.find((statement) => statement.sql.includes("INSERT INTO media_assets"))?.bindings[3])
      .toBe("voice-note.ogg");
    expect(bucket.put).toHaveBeenCalledWith(
      `media/${MEDIA_ID}/full.ogg`,
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "audio/ogg" } },
    );

    await expect(new MediaService(db, bucket).createAudio({
      ownerUserId: "owner-1",
      originalName: "   ",
      data: oggOpus(),
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
    })).rejects.toThrow(/between 1 and 255/);
  });

  it("compensates every exact key and D1 row when an R2 put fails", async () => {
    const uploadError = new Error("put failed");
    const { db, statements } = fakeDb();
    const bucket = fakeBucket();
    bucket.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(uploadError);

    await expect(new MediaService(db, bucket).create({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      mediaType: "image",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
      variants: { full: vp8(800, 600), view: vp8(800, 600) },
    })).rejects.toBe(uploadError);
    expect(bucket.delete).toHaveBeenCalledWith([
      `media/${MEDIA_ID}/full.webp`,
      `media/${MEDIA_ID}/view.webp`,
    ]);
    expect(statements.some((statement) => statement.sql.includes("DELETE FROM media_assets"))).toBe(true);
  });

  it("retains pending D1 truth when R2 upload compensation fails", async () => {
    const { db, statements } = fakeDb();
    const bucket = fakeBucket();
    bucket.put.mockRejectedValueOnce(new Error("put failed"));
    bucket.delete.mockRejectedValueOnce(new Error("delete failed"));

    await expect(new MediaService(db, bucket).create({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      mediaType: "image",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
      variants: { full: vp8(800, 600), view: vp8(800, 600) },
    })).rejects.toBeInstanceOf(AggregateError);
    expect(statements.some((statement) => statement.sql.includes("DELETE FROM media_assets"))).toBe(false);
  });

  it("removes earlier assets when the second image in one call fails", async () => {
    vi.mocked(nanoid).mockReturnValueOnce(MEDIA_ID).mockReturnValueOnce(MEDIA_ID_TWO);
    const { db } = fakeDb((method, sql) => {
      if (method === "all" && sql.includes("FROM media_assets") && !sql.includes(" asset")) {
        return { results: [{ id: MEDIA_ID, media_type: "image" }] };
      }
      return null;
    });
    const bucket = fakeBucket();
    bucket.put
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second image failed"));
    const upload = {
      full: vp8(800, 600),
      view: vp8(800, 600),
    };

    await expect(new MediaService(db, bucket).createImages({
      ownerUserId: "owner-1",
      purpose: "gallery_image",
      uploads: [upload, upload],
      now: "2026-08-08T00:00:00.000Z",
      maxBytes: 10_000,
    })).rejects.toThrow("second image failed");
    expect(bucket.delete).toHaveBeenNthCalledWith(1, [
      `media/${MEDIA_ID_TWO}/full.webp`,
      `media/${MEDIA_ID_TWO}/view.webp`,
    ]);
    expect(bucket.delete).toHaveBeenNthCalledWith(2, [
      `media/${MEDIA_ID}/full.webp`,
      `media/${MEDIA_ID}/view.webp`,
    ]);
  });

  it("marks pending media ready only when all mandatory D1 variants are valid", async () => {
    const { db, prepare } = fakeDb((method, sql) => {
      if (method === "first" && sql.includes("FROM media_assets")) return { ...readyAsset, state: "pending" };
      if (method === "all" && sql.includes("FROM media_variants")) return { results: storedImageVariants() };
      if (method === "run") return { meta: { changes: 1 } };
      return null;
    });
    await expect(new MediaService(db, fakeBucket()).markReady(MEDIA_ID, "2026-08-08T00:00:00.000Z")).resolves.toBeUndefined();
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("SET state = 'ready'"));
  });

  it("attaches, replaces, and detaches through one link table", async () => {
    const { db, batch, statements } = fakeDb((method, sql) => {
      if (method === "first" && sql.includes("FROM media_assets")) return readyAsset;
      if (method === "all" && sql.includes("FROM media_assets")) return { results: [readyAsset] };
      if (method === "all" && sql.includes("FROM media_links")) return { results: [{ media_id: "Olddefghijklmnopqrstu" }] };
      return null;
    });
    const service = new MediaService(db, fakeBucket());
    const now = "2026-08-08T00:00:00.000Z";
    await service.attach({ mediaId: MEDIA_ID, entityType: "gallery_item", entityId: "item-1", slot: "image", sortOrder: 0, now });
    await service.replace({ entityType: "gallery_item", entityId: "item-1", slot: "image", media: [{ mediaId: MEDIA_ID, sortOrder: 0 }], now });
    await service.detach({ mediaId: MEDIA_ID, entityType: "gallery_item", entityId: "item-1", slot: "image", now });
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("INSERT INTO media_links");
    expect(sql).toContain("DELETE FROM media_links");
    expect(sql).not.toContain("UPDATE media_assets");
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("allows an administrator to retain and reorder an existing foreign-owned link", async () => {
    const foreignAsset = { ...readyAsset, owner_user_id: "member-owner", purpose: "member_image", expires_at: null };
    const { db, batch } = fakeDb((method, sql) => {
      if (method === "all" && sql.includes("FROM media_links")) return { results: [{ media_id: MEDIA_ID }] };
      if (method === "all" && sql.includes("FROM media_assets")) return { results: [foreignAsset] };
      return null;
    });

    await expect(new MediaService(db, fakeBucket()).replace({
      entityType: "member_profile",
      entityId: "member-1",
      slot: "image",
      media: [{ mediaId: MEDIA_ID, sortOrder: 3 }],
      ownerUserId: "admin-owner",
      now: "2026-08-08T00:00:00.000Z",
    })).resolves.toBeUndefined();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("rejects a newly added ready asset owned by another user", async () => {
    const foreignAsset = { ...readyAsset, owner_user_id: "other-owner", purpose: "member_image", expires_at: null };
    const { db, batch } = fakeDb((method, sql) => {
      if (method === "all" && sql.includes("FROM media_links")) return { results: [] };
      if (method === "all" && sql.includes("FROM media_assets")) return { results: [foreignAsset] };
      return null;
    });

    await expect(new MediaService(db, fakeBucket()).replace({
      entityType: "member_profile",
      entityId: "member-1",
      slot: "image",
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
      ownerUserId: "admin-owner",
      now: "2026-08-08T00:00:00.000Z",
    })).rejects.toThrow(/another user/);
    expect(batch).not.toHaveBeenCalled();
  });

  it("applies singularity to the entity-slot pair from the shared contract", async () => {
    const { db, prepare } = fakeDb();
    await expect(new MediaService(db, fakeBucket()).replace({
      entityType: "gallery_item",
      entityId: "item-1",
      slot: "image",
      media: [
        { mediaId: MEDIA_ID, sortOrder: 0 },
        { mediaId: MEDIA_ID_TWO, sortOrder: 1 },
      ],
      ownerUserId: "owner-1",
      now: "2026-08-08T00:00:00.000Z",
    })).rejects.toThrow(/only one media asset/);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("counts logical D1 assets plus live pending reservations without listing R2", async () => {
    const { db, statements } = fakeDb((method) => method === "first" ? { used: 3 } : null);
    const bucket = fakeBucket();
    const service = new MediaService(db, bucket);
    await expect(service.checkQuota({
      purpose: "wiki_image",
      ownerUserId: "owner-1",
      scope: { kind: "entity", entityType: "wiki_article", entityId: "article-1" },
      limit: 4,
      incomingCount: 2,
      now: "2026-08-08T00:00:00.000Z",
    })).resolves.toBe(false);
    expect(statements[0]?.sql).toContain("FROM media_links");
    expect(statements[0]?.sql).toContain("asset.state = 'pending'");
    expect(bucket.list).not.toHaveBeenCalled();
  });

  it("keeps pending-only and owner quota scopes explicit", async () => {
    const { db, statements } = fakeDb((method) => method === "first" ? { used: 1 } : null);
    const service = new MediaService(db, fakeBucket());
    const common = {
      purpose: "gallery_image" as const,
      ownerUserId: "owner-1",
      limit: 2,
      incomingCount: 1,
      now: "2026-08-08T00:00:00.000Z",
    };

    await expect(service.checkQuota({ ...common, scope: { kind: "pending" } })).resolves.toBe(true);
    await expect(service.checkQuota({ ...common, scope: { kind: "owner" } })).resolves.toBe(true);

    expect(statements[0]?.sql).toContain("asset.state = 'pending'");
    expect(statements[0]?.sql).not.toContain("media_links");
    expect(statements[0]?.sql).not.toContain("asset.state = 'ready'");
    expect(statements[1]?.sql).toContain("asset.state = 'ready' AND EXISTS");
    expect(statements[1]?.sql).toContain("asset.state = 'pending' AND asset.expires_at >");
  });

  it("allows owner preview for a live pending asset and applies static link visibility", async () => {
    let mode: "pending" | "public" = "pending";
    let publicTarget: "class" | "site" = "class";
    const { db } = fakeDb((method, sql) => {
      if (method === "first" && sql.includes("INNER JOIN media_variants")) {
        return {
          ...readyAsset,
          purpose: mode === "public"
            ? publicTarget === "class" ? "class_icon" : "site_logo"
            : "gallery_image",
          state: mode === "pending" ? "pending" : "ready",
          variant: "view",
        };
      }
      if (method === "all" && sql.includes("FROM media_links")) {
        return { results: [publicTarget === "class"
          ? { entity_type: "class_catalog", entity_id: "class-1", slot: "icon" }
          : { entity_type: "site_config", entity_id: "site", slot: "logo" }] };
      }
      if (method === "first" && sql.includes("FROM class_catalog")) return { present: 1 };
      if (method === "first" && sql.includes("FROM site_config")) return { present: 1 };
      return null;
    });
    const service = new MediaService(db, fakeBucket());
    const session = { id: "owner-1", permissions: new Set<Permission>() };
    await expect(service.resolveReadableVariant({ mediaId: MEDIA_ID, variant: "view", session, now: "2026-08-08T00:00:00.000Z" }))
      .resolves.toEqual({ r2Key: `media/${MEDIA_ID}/view.webp`, contentType: "image/webp" });
    mode = "public";
    await expect(service.resolveReadableVariant({ mediaId: MEDIA_ID, variant: "view", session: null, now: "2026-08-08T00:00:00.000Z" }))
      .resolves.toEqual({ r2Key: `media/${MEDIA_ID}/view.webp`, contentType: "image/webp" });
    publicTarget = "site";
    await expect(service.resolveReadableVariant({ mediaId: MEDIA_ID, variant: "view", session: null, now: "2026-08-08T00:00:00.000Z" }))
      .resolves.toEqual({ r2Key: `media/${MEDIA_ID}/view.webp`, contentType: "image/webp" });
  });

  it("makes active member media public and restricts inactive members to user administrators", async () => {
    let active = true;
    const { db, statements } = fakeDb((method, sql, bindings) => {
      if (method === "first" && sql.includes("INNER JOIN media_variants")) return readableAsset("member_image");
      if (method === "all" && sql.includes("FROM media_links")) {
        return { results: [{ entity_type: "member_profile", entity_id: "member-1", slot: "image" }] };
      }
      if (method === "first" && sql.includes("FROM member_profiles")) {
        return active || bindings[1] === 1 ? { present: 1 } : null;
      }
      return null;
    });
    const service = new MediaService(db, fakeBucket());
    const input = { mediaId: MEDIA_ID, variant: "view" as const, now: "2026-08-08T00:00:00.000Z" };

    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.not.toBeNull();
    active = false;
    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.toBeNull();
    await expect(service.resolveReadableVariant({
      ...input,
      session: { id: "admin", permissions: new Set<Permission>(["admin.users.view"]) },
    })).resolves.not.toBeNull();
    expect(statements.find((statement) => statement.sql.includes("FROM member_profiles"))?.sql).toContain("user.deleted_at IS NULL");
  });

  it("makes linked gallery and wiki images public", async () => {
    let purpose: MediaPurpose = "gallery_image";
    let entityType: MediaEntityType = "gallery_item";
    let entityId = "gallery-1";
    let slot: MediaLinkSlot = "image";
    const { db } = fakeDb((method, sql) => {
      if (method === "first" && sql.includes("INNER JOIN media_variants")) return readableAsset(purpose);
      if (method === "all" && sql.includes("FROM media_links")) return { results: [{ entity_type: entityType, entity_id: entityId, slot }] };
      if (method === "first" && (sql.includes("FROM gallery_items") || sql.includes("FROM wiki_articles"))) return { present: 1 };
      return null;
    });
    const service = new MediaService(db, fakeBucket());
    const input = { mediaId: MEDIA_ID, variant: "view" as const, session: null, now: "2026-08-08T00:00:00.000Z" };

    await expect(service.resolveReadableVariant(input)).resolves.not.toBeNull();
    purpose = "wiki_image";
    entityType = "wiki_article";
    entityId = "wiki-1";
    slot = "body";
    await expect(service.resolveReadableVariant(input)).resolves.not.toBeNull();
  });

  it("restricts draft announcements and future events to their managers", async () => {
    let purpose: MediaPurpose = "announcement_image";
    let entityType: MediaEntityType = "announcement";
    let entityId = "announcement-1";
    let slot: MediaLinkSlot = "body";
    let publiclyVisible = false;
    const { db } = fakeDb((method, sql, bindings) => {
      if (method === "first" && sql.includes("INNER JOIN media_variants")) return readableAsset(purpose);
      if (method === "all" && sql.includes("FROM media_links")) return { results: [{ entity_type: entityType, entity_id: entityId, slot }] };
      if (method === "first" && (sql.includes("FROM announcements") || sql.includes("FROM events"))) {
        return publiclyVisible || bindings[1] === 1 ? { present: 1 } : null;
      }
      return null;
    });
    const service = new MediaService(db, fakeBucket());
    const input = { mediaId: MEDIA_ID, variant: "view" as const, now: "2026-08-08T00:00:00.000Z" };

    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.toBeNull();
    await expect(service.resolveReadableVariant({
      ...input,
      session: { id: "announcement-manager", permissions: new Set<Permission>(["announcements.edit"]) },
    })).resolves.not.toBeNull();
    publiclyVisible = true;
    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.not.toBeNull();

    purpose = "event_image";
    entityType = "event";
    entityId = "event-1";
    slot = "attachment";
    publiclyVisible = false;
    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.toBeNull();
    await expect(service.resolveReadableVariant({
      ...input,
      session: { id: "event-manager", permissions: new Set<Permission>(["events.edit"]) },
    })).resolves.not.toBeNull();
  });

  it("requires template management for recurring media and authentication for storage media", async () => {
    let purpose: MediaPurpose = "event_image";
    let entityType: MediaEntityType = "recurring_template";
    let entityId = "template-1";
    let slot: MediaLinkSlot = "attachment";
    const { db } = fakeDb((method, sql) => {
      if (method === "first" && sql.includes("INNER JOIN media_variants")) return readableAsset(purpose);
      if (method === "all" && sql.includes("FROM media_links")) return { results: [{ entity_type: entityType, entity_id: entityId, slot }] };
      if (method === "first" && (sql.includes("FROM recurring_templates") || sql.includes("FROM storage_items"))) return { present: 1 };
      return null;
    });
    const service = new MediaService(db, fakeBucket());
    const input = { mediaId: MEDIA_ID, variant: "view" as const, now: "2026-08-08T00:00:00.000Z" };

    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.toBeNull();
    await expect(service.resolveReadableVariant({
      ...input,
      session: { id: "template-manager", permissions: new Set<Permission>(["events.templates"]) },
    })).resolves.not.toBeNull();

    purpose = "storage_image";
    entityType = "storage_item";
    entityId = "storage-1";
    slot = "image";
    await expect(service.resolveReadableVariant({ ...input, session: null })).resolves.toBeNull();
    await expect(service.resolveReadableVariant({
      ...input,
      session: { id: "member", permissions: new Set<Permission>() },
    })).resolves.not.toBeNull();
  });

  it("deletes expired unlinked assets by deterministic keys without listing R2", async () => {
    let page = 0;
    const { db } = fakeDb((method, sql) => {
      if (method === "all" && sql.includes("FROM media_assets asset")) {
        return { results: page++ === 0 ? [{ id: MEDIA_ID, media_type: "image" }] : [] };
      }
      return null;
    });
    const bucket = fakeBucket();
    await expect(new MediaService(db, bucket).deleteUnclaimed("2026-08-08T00:00:00.000Z")).resolves.toBe(1);
    expect(bucket.delete).toHaveBeenCalledWith([
      `media/${MEDIA_ID}/full.webp`,
      `media/${MEDIA_ID}/view.webp`,
    ]);
    expect(bucket.list).not.toHaveBeenCalled();
  });

  it("derives every mandatory cleanup key without reading variant rows", async () => {
    let page = 0;
    const { db } = fakeDb((method, sql) => {
      if (method === "all" && sql.includes("FROM media_assets asset")) {
        return { results: page++ === 0 ? [{ id: MEDIA_ID, media_type: "image" }] : [] };
      }
      return null;
    });
    const bucket = fakeBucket();

    await expect(new MediaService(db, bucket).deleteUnclaimed("2026-08-08T00:00:00.000Z"))
      .resolves.toBe(1);
    expect(bucket.delete).toHaveBeenCalledWith([
      `media/${MEDIA_ID}/full.webp`,
      `media/${MEDIA_ID}/view.webp`,
    ]);
  });
});
