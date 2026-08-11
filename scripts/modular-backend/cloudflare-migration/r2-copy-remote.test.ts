import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { R2_MAX_OBJECT_BYTES, readWebpDimensions } from "./r2-copy-contract.mjs";
import { copyR2ViaWorker, inventoryR2ViaWorker } from "./r2-copy-client.mjs";
import worker from "./r2-copy-worker.mjs";

const TOKEN = "a".repeat(64);
const ENDPOINT = "https://temporary-copy.example.workers.dev/";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("temporary R2 copy Worker", () => {
  it("authenticates, normalizes missing source MIME, copies Unicode Ogg/Opus unchanged, and reconciles by HEAD", async () => {
    const source = new FakeBucket();
    const target = new FakeBucket();
    const bytes = oggOpus();
    const entry = audioEntry("aaaaaaaaaaaaaaaaaaaaa", "members/用户甲/audio/角色介绍/你好 世界.ogg", bytes.length);
    source.seed(entry.sourceKey, bytes, null);
    const env = environment(source, target);

    expect((await worker.fetch(new Request(`${ENDPOINT}inventory/source`), env)).status).toBe(401);
    const result = await postCopy(entry, env);
    const payload = await result.json() as {
      sourceContentTypeNormalized: boolean;
      object: { sha256: string; width: null; height: null };
    };

    expect(result.status).toBe(200);
    expect(payload.sourceContentTypeNormalized).toBe(true);
    expect(payload.object).toMatchObject({ width: null, height: null });
    expect(target.bytes(entry.targetKey)).toEqual(bytes);
    expect(target.puts[0]).toMatchObject({
      key: entry.targetKey,
      onlyIf: { etagDoesNotMatch: "*" },
      contentType: "audio/ogg",
      customMetadata: { sha256: payload.object.sha256 },
    });
    expect(source.puts).toEqual([]);

    const head = await worker.fetch(headRequest({ ...entry, sha256: payload.object.sha256 }), env);
    expect(head.status).toBe(200);
    expect(head.headers.get("x-content-sha256")).toBe(payload.object.sha256);
  });

  it("copies one legacy WebP into full/view, exposes paged read-only inventory, and parses all supported WebP headers", async () => {
    expect(readWebpDimensions(webpLossless(17, 19))).toEqual({ width: 17, height: 19 });
    expect(readWebpDimensions(webpLossy(23, 29))).toEqual({ width: 23, height: 29 });
    expect(readWebpDimensions(webpExtended(31, 37))).toEqual({ width: 31, height: 37 });

    const source = new FakeBucket(1);
    const target = new FakeBucket();
    const bytes = webpLossless(80, 60);
    const sourceKey = "gallery/users/用户甲/portrait.webp";
    source.seed(sourceKey, bytes, "image/webp");
    source.seed("audit-archive/2026/07/manifest.json", Buffer.from("{}"), "application/json");
    const env = environment(source, target);
    const full = imageEntry("bbbbbbbbbbbbbbbbbbbbb", "full", sourceKey, bytes.length);
    const view = imageEntry("bbbbbbbbbbbbbbbbbbbbb", "view", sourceKey, bytes.length);

    const [fullResponse, viewResponse] = await Promise.all([postCopy(full, env), postCopy(view, env)]);
    const fullResult = await fullResponse.json() as { object: Record<string, unknown> };
    const viewResult = await viewResponse.json() as { object: Record<string, unknown> };
    expect(fullResult.object).toMatchObject({ width: 80, height: 60 });
    expect(viewResult.object).toMatchObject({ width: 80, height: 60 });
    expect(target.bytes(full.targetKey)).toEqual(bytes);
    expect(target.bytes(view.targetKey)).toEqual(bytes);

    const first = await inventoryRequest("source", env, 1);
    const firstPage = await first.json() as { objects: unknown[]; nextCursor: string };
    expect(firstPage.objects).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const second = await inventoryRequest("source", env, 1, firstPage.nextCursor);
    const secondPage = await second.json() as { objects: Array<Record<string, unknown>>; nextCursor: null };
    expect(secondPage.objects[0]).toEqual(expect.objectContaining({
      key: sourceKey,
      size: bytes.length,
      contentType: "image/webp",
      etag: expect.any(String),
      customMetadata: {},
      checksum: expect.any(String),
    }));
    expect(secondPage.nextCursor).toBeNull();
  });

  it("refuses oversized manifests and never overwrites a conflicting target", async () => {
    const source = new FakeBucket();
    const target = new FakeBucket();
    const bytes = webpLossless(5, 6);
    const entry = imageEntry("ccccccccccccccccccccc", "full", "members/u/images/source.webp", bytes.length);
    source.seed(entry.sourceKey, bytes, "image/webp");
    target.seed(entry.targetKey, Buffer.from("different"), "image/webp", { sha256: "0".repeat(64) });
    const env = environment(source, target);

    expect((await postCopy(entry, env)).status).toBe(409);
    expect(target.bytes(entry.targetKey)).toEqual(Buffer.from("different"));
    expect(target.puts).toEqual([]);

    expect((await postCopy({ ...entry, byteSize: R2_MAX_OBJECT_BYTES + 1 }, env)).status).toBe(400);
    expect(source.puts).toEqual([]);
  });

  it("uploads and then verifies an explicitly pretransformed image", async () => {
    const source = new FakeBucket();
    const target = new FakeBucket();
    const env = environment(source, target);
    const bytes = webpLossless(32, 18);
    const sha256 = digest(bytes);
    const mediaId = "ttttttttttttttttttttt";
    const targetKey = `media/${mediaId}/full.webp`;
    const upload = await worker.fetch(new Request(`${ENDPOINT}object`, {
      method: "PUT",
      headers: {
        "content-type": "image/webp",
        "content-length": String(bytes.length),
        "x-infini-migration-token": TOKEN,
        "x-infini-object-key": targetKey,
        "x-infini-content-sha256": sha256,
        "x-infini-image-width": "32",
        "x-infini-image-height": "18",
      },
      body: Uint8Array.from(bytes),
    }), env);
    expect(upload.status).toBe(200);

    const entry = {
      ...imageEntry(mediaId, "full", "members/u/images/legacy.webp", bytes.length),
      sha256,
      width: 32,
      height: 18,
      sourceByteSize: 4_017_990,
      sourceContentType: "image/webp",
      pretransformed: true,
    };
    const verified = await postCopy(entry, env);
    expect(verified.status).toBe(200);
    expect(target.puts).toEqual([expect.objectContaining({ key: targetKey })]);
  });
});

describe("R2 copy checkpoint client", () => {
  it("inventories both buckets, resumes page checkpoints, reports preserved/orphan objects, and HEAD-reconciles every target", async () => {
    const workspace = await createWorkspace();
    const source = new FakeBucket(2);
    const target = new FakeBucket(2);
    const imageBytes = webpLossless(120, 90);
    const audioBytes = oggOpus();
    const imageSource = "gallery/users/member/image.webp";
    const audioSource = "members/用户乙/audio/介绍.ogg";
    source.seed(imageSource, imageBytes, "image/webp");
    source.seed(audioSource, audioBytes, null);
    source.seed("gallery/users/orphan.webp", webpLossless(2, 2), "image/webp");
    source.seed("audit-archive/2026/07/part.ndjson.gz", Buffer.from("archive"), "application/gzip");
    const env = environment(source, target);
    const objects = [
      imageEntry("ddddddddddddddddddddd", "full", imageSource, imageBytes.length),
      imageEntry("ddddddddddddddddddddd", "view", imageSource, imageBytes.length),
      audioEntry("eeeeeeeeeeeeeeeeeeeee", audioSource, audioBytes.length),
    ];
    await writeFile(workspace.manifest, JSON.stringify({ version: 1, objects }), "utf8");

    const inventory = await inventoryR2ViaWorker({
      reportPath: workspace.inventory,
      endpoint: ENDPOINT,
      token: TOKEN,
      fetchImpl: workerFetch(env),
    });
    expect(inventory.source.count).toBe(4);
    expect(inventory.target.count).toBe(0);
    await expect(readJson(workspace.inventory)).resolves.toEqual(inventory);

    let failThirdPost = true;
    let postCount = 0;
    let headCount = 0;
    const fetchImpl = workerFetch(env, (request) => {
      if (request.method === "POST") {
        postCount += 1;
        if (failThirdPost && postCount === 3) return new Response("unavailable", { status: 503 });
      }
      if (request.method === "HEAD") headCount += 1;
      return null;
    });

    await expect(copyClient(workspace, fetchImpl)).rejects.toThrow(/HTTP 503/);
    await expect(readJson(workspace.checkpoint)).resolves.toMatchObject({ nextIndex: 2 });
    failThirdPost = false;
    const report = await copyClient(workspace, fetchImpl);

    expect(headCount).toBe(3);
    expect(report.phase).toBe("complete");
    expect(report.sourceInventory).toMatchObject({
      scanned: 4,
      referenced: 2,
      orphan: 1,
      separatePreserve: 1,
      normalized: 1,
      unknown: 0,
    });
    expect(report.targetInventory).toEqual({ scanned: 3, expected: 3, unknown: 0 });
    expect(report.summary).toEqual({ expected: 3, verified: 3, findings: 0, warnings: 3 });
    expect(report.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetKey: objects[0]!.targetKey, width: 120, height: 90 }),
      expect.objectContaining({ targetKey: objects[2]!.targetKey, width: null, height: null }),
    ]));
  });

  it("fails before copying when source inventory contains an unknown business prefix", async () => {
    const workspace = await createWorkspace();
    const source = new FakeBucket();
    const target = new FakeBucket();
    const bytes = webpLossless(3, 4);
    const entry = imageEntry("fffffffffffffffffffff", "full", "gallery/users/known.webp", bytes.length);
    source.seed(entry.sourceKey, bytes, "image/webp");
    source.seed("mystery/private.bin", Buffer.from("unknown"), "application/octet-stream");
    await writeFile(workspace.manifest, JSON.stringify({ version: 1, objects: [entry] }), "utf8");

    await expect(copyClient(workspace, workerFetch(environment(source, target))))
      .rejects.toThrow(/Source inventory has 1 blocking finding/);
    expect(target.puts).toEqual([]);
    await expect(readJson(workspace.report)).resolves.toMatchObject({
      phase: "source_inventory_failed",
      findings: [{ kind: "unknown_source", key: "mystery/private.bin" }],
    });
  });
});

class FakeBucket {
  readonly puts: Array<Record<string, unknown>> = [];
  private readonly objects = new Map<string, StoredObject>();

  constructor(private readonly maximumPageSize = Number.MAX_SAFE_INTEGER) {}

  seed(key: string, bytes: Buffer, contentType: string | null, customMetadata: Record<string, string> = {}): void {
    const sha256 = digest(bytes);
    this.objects.set(key, { key, bytes, contentType, customMetadata, sha256, etag: `etag-${sha256.slice(0, 12)}` });
  }

  bytes(key: string): Buffer | undefined {
    return this.objects.get(key)?.bytes;
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      ...metadata(object),
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(object.bytes); controller.close(); } }),
      arrayBuffer: async () => object.bytes.buffer.slice(
        object.bytes.byteOffset,
        object.bytes.byteOffset + object.bytes.byteLength,
      ),
    };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? metadata(object) : null;
  }

  async put(key: string, body: Uint8Array, options: {
    onlyIf: { etagDoesNotMatch: string };
    httpMetadata: { contentType: string };
    customMetadata: Record<string, string>;
  }) {
    if (this.objects.has(key)) return null;
    const bytes = Buffer.from(body);
    this.seed(key, bytes, options.httpMetadata.contentType, options.customMetadata);
    this.puts.push({
      key,
      onlyIf: options.onlyIf,
      contentType: options.httpMetadata.contentType,
      customMetadata: options.customMetadata,
    });
    return this.head(key);
  }

  async list({ limit, prefix, cursor }: { limit: number; prefix: string; cursor?: string }) {
    const all = [...this.objects.values()].filter(({ key }) => key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
    const start = cursor ? Number(cursor) : 0;
    const pageSize = Math.min(limit, this.maximumPageSize);
    const selected = all.slice(start, start + pageSize).map(metadata);
    const next = start + selected.length;
    return { objects: selected, truncated: next < all.length, ...(next < all.length ? { cursor: String(next) } : {}) };
  }
}

type StoredObject = Readonly<{
  key: string;
  bytes: Buffer;
  contentType: string | null;
  customMetadata: Record<string, string>;
  sha256: string;
  etag: string;
}>;

function metadata(object: StoredObject) {
  return {
    key: object.key,
    size: object.bytes.length,
    etag: object.etag,
    httpMetadata: object.contentType === null ? {} : { contentType: object.contentType },
    customMetadata: object.customMetadata,
    checksums: { toJSON: () => ({ sha256: object.sha256 }) },
  };
}

function environment(source: FakeBucket, target: FakeBucket) {
  return { SOURCE: source, TARGET: target, MIGRATION_ACCESS_KEY: TOKEN };
}

function workerFetch(env: ReturnType<typeof environment>, intercept?: (request: Request) => Response | null) {
  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    return intercept?.(request) ?? worker.fetch(request, env);
  };
}

function postCopy(entry: Record<string, unknown>, env: ReturnType<typeof environment>) {
  return worker.fetch(new Request(`${ENDPOINT}copy`, {
    method: "POST",
    headers: { "x-infini-migration-token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify(entry),
  }), env);
}

function headRequest(entry: { targetKey: string; byteSize: number; contentType: string; sha256: string }) {
  const url = new URL(`${ENDPOINT}object`);
  url.search = new URLSearchParams({
    targetKey: entry.targetKey,
    byteSize: String(entry.byteSize),
    contentType: entry.contentType,
    sha256: entry.sha256,
  }).toString();
  return new Request(url, { method: "HEAD", headers: { "x-infini-migration-token": TOKEN } });
}

function inventoryRequest(side: "source" | "target", env: ReturnType<typeof environment>, limit: number, cursor?: string) {
  const url = new URL(`${ENDPOINT}inventory/${side}`);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  return worker.fetch(new Request(url, { headers: { "x-infini-migration-token": TOKEN } }), env);
}

function imageEntry(mediaId: string, variant: "full" | "view", sourceKey: string, byteSize: number) {
  return {
    mediaId,
    variant,
    sourceKey,
    targetKey: `media/${mediaId}/${variant}.webp`,
    byteSize,
    contentType: "image/webp",
  };
}

function audioEntry(mediaId: string, sourceKey: string, byteSize: number) {
  return {
    mediaId,
    variant: "full",
    sourceKey,
    targetKey: `media/${mediaId}/full.opus`,
    byteSize,
    contentType: "audio/ogg",
    width: null,
    height: null,
  };
}

function webpLossless(width: number, height: number): Buffer {
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  return riff([["VP8L", Buffer.from([
    0x2f,
    encodedWidth & 0xff,
    ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6),
    (encodedHeight >> 2) & 0xff,
    (encodedHeight >> 10) & 0x0f,
  ])]]);
}

function webpLossy(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.set([0x9d, 0x01, 0x2a], 3);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return riff([["VP8 ", data]]);
}

function webpExtended(width: number, height: number): Buffer {
  const canvas = Buffer.alloc(10);
  writeUint24(canvas, 4, width - 1);
  writeUint24(canvas, 7, height - 1);
  const frame = webpLossless(width, height).subarray(20, 25);
  return riff([["VP8X", canvas], ["VP8L", frame]]);
}

function riff(chunks: Array<readonly [string, Buffer]>): Buffer {
  const encoded = chunks.map(([kind, data]) => {
    const chunk = Buffer.alloc(8 + data.length + (data.length & 1));
    chunk.write(kind, 0, "ascii");
    chunk.writeUInt32LE(data.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...encoded]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function writeUint24(bytes: Buffer, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

function oggOpus(): Buffer {
  const bytes = Buffer.alloc(35);
  bytes.write("OggS", 0, "ascii");
  bytes[26] = 0;
  bytes.write("OpusHead", 27, "ascii");
  return bytes;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "infini-r2-remote-test-"));
  temporaryDirectories.push(root);
  return {
    manifest: join(root, "manifest.json"),
    checkpoint: join(root, "checkpoint.json"),
    report: join(root, "report.json"),
    inventory: join(root, "inventory.json"),
  };
}

function copyClient(workspace: Awaited<ReturnType<typeof createWorkspace>>, fetchImpl: typeof fetch) {
  return copyR2ViaWorker({
    manifestPath: workspace.manifest,
    checkpointPath: workspace.checkpoint,
    reportPath: workspace.report,
    endpoint: ENDPOINT,
    token: TOKEN,
    concurrency: 1,
    pageSize: 2,
    fetchImpl,
  });
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
