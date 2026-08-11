import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyR2FromManifest } from "./r2-copy.mjs";

type ManifestObject = Readonly<{
  mediaId: string;
  variant: "full" | "view";
  sourceKey: string;
  targetKey: string;
  byteSize: number;
  contentType: "image/webp" | "audio/ogg";
}>;

type Metadata = Readonly<{
  key: string;
  size: number;
  contentType: string;
  sha256: string;
}>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("R2 blue-green copy", () => {
  it("checkpoints complete pages and resumes without reading completed source objects", async () => {
    const workspace = await createWorkspace();
    const entries = [
      image("aaaaaaaaaaaaaaaaaaaaa", "full", webp(20, 10)),
      image("bbbbbbbbbbbbbbbbbbbbb", "view", webp(11, 7)),
      image("ccccccccccccccccccccc", "full", webp(9, 13)),
    ];
    await writeManifest(workspace.manifest, entries.map(({ entry }) => entry));
    const source = new FakeSource(entries.slice(0, 2));
    const target = new FakeTarget();

    await expect(copy(workspace, source, target, { concurrency: 1, pageSize: 2 }))
      .rejects.toThrow(/\[missing\].*cccc/);
    await expect(readJson(workspace.checkpoint)).resolves.toMatchObject({ nextIndex: 2 });

    source.add(entries[2]!);
    const report = await copy(workspace, source, target, { concurrency: 1, pageSize: 2 });

    expect(source.calls).toEqual(new Map([
      [entries[0]!.entry.sourceKey, 1],
      [entries[1]!.entry.sourceKey, 1],
      [entries[2]!.entry.sourceKey, 2],
    ]));
    expect(target.puts).toHaveLength(3);
    expect(report.summary).toEqual({ expected: 3, verified: 3, findings: 0 });
    await expect(readJson(workspace.checkpoint)).resolves.toMatchObject({ nextIndex: 3 });
    await expect(readJson(workspace.report)).resolves.toEqual(report);
  });

  it("streams legacy full.ogg bytes unchanged to full.opus with canonical SHA-256 metadata", async () => {
    const workspace = await createWorkspace();
    const bytes = oggOpus();
    const object = audio(
      "ddddddddddddddddddddd",
      bytes,
      "members/用户甲/audio/角色介绍/你好 世界.ogg",
    );
    await writeManifest(workspace.manifest, [object.entry]);
    const source = new FakeSource([object]);
    const target = new FakeTarget();

    const report = await copy(workspace, source, target);
    const expectedHash = createHash("sha256").update(bytes).digest("hex");

    expect(target.puts).toEqual([{
      key: "media/ddddddddddddddddddddd/full.opus",
      size: bytes.length,
      contentType: "audio/ogg",
      sha256: expectedHash,
      customMetadata: { sha256: expectedHash },
    }]);
    expect(target.bytes.get(object.entry.targetKey)).toEqual(bytes);
    expect(report.objects).toEqual([{ ...object.entry, sha256: expectedHash, width: null, height: null }]);
  });

  it("copies one arbitrary legacy image source into canonical full and view targets", async () => {
    const workspace = await createWorkspace();
    const bytes = webp(80, 60);
    const mediaId = "ggggggggggggggggggggg";
    const sourceKey = "gallery/users/用户甲/portrait.webp";
    const full = { ...image(mediaId, "full", bytes).entry, sourceKey };
    const view = { ...image(mediaId, "view", bytes).entry, sourceKey };
    await writeManifest(workspace.manifest, [full, view]);
    const source = new FakeSource([{ entry: full, bytes }]);
    const target = new FakeTarget();

    const report = await copy(workspace, source, target);

    expect(source.calls.get(sourceKey)).toBe(2);
    expect(target.bytes.get(full.targetKey)).toEqual(bytes);
    expect(target.bytes.get(view.targetKey)).toEqual(bytes);
    expect(report.objects.map(({
      sourceKey: source,
      targetKey,
    }: { sourceKey: string; targetKey: string }) => ({ source, targetKey }))).toEqual([
      { source: sourceKey, targetKey: full.targetKey },
      { source: sourceKey, targetKey: view.targetKey },
    ]);
  });

  it("fails closed when an existing target has conflicting metadata", async () => {
    const workspace = await createWorkspace();
    const object = image("eeeeeeeeeeeeeeeeeeeee", "full", webp(4, 3));
    await writeManifest(workspace.manifest, [object.entry]);
    const source = new FakeSource([object]);
    const target = new FakeTarget();
    target.seed(object.entry.targetKey, Buffer.from("different"), object.entry.contentType, "0".repeat(64));

    await expect(copy(workspace, source, target)).rejects.toThrow(/\[conflict\].*already exists/);
    expect(target.puts).toEqual([]);
    expect(target.bytes.get(object.entry.targetKey)).toEqual(Buffer.from("different"));
  });

  it("rejects unknown keys, invalid concurrency, and source size/MIME mismatches", async () => {
    const unknownWorkspace = await createWorkspace();
    const object = audio("fffffffffffffffffffff", Buffer.from("audio"));
    await writeManifest(unknownWorkspace.manifest, [{
      ...object.entry,
      sourceKey: "media/fffffffffffffffffffff/full.mp3",
    }]);

    await expect(copy(unknownWorkspace, new FakeSource([object]), new FakeTarget()))
      .rejects.toThrow(/\[unknown\].*audio source key must end in \.ogg/);
    await expect(copy(unknownWorkspace, new FakeSource([object]), new FakeTarget(), { concurrency: 5 }))
      .rejects.toThrow(/concurrency must be between 1 and 4/);

    const metadataWorkspace = await createWorkspace();
    await writeManifest(metadataWorkspace.manifest, [object.entry]);
    const source = new FakeSource([object]);
    source.contentTypeOverrides.set(object.entry.sourceKey, "application/octet-stream");
    const target = new FakeTarget();

    await expect(copy(metadataWorkspace, source, target)).rejects.toThrow(/size\/MIME/);
    expect(target.puts).toEqual([]);
  });
});

class FakeSource {
  readonly calls = new Map<string, number>();
  readonly contentTypeOverrides = new Map<string, string>();
  private readonly objects = new Map<string, Readonly<{ entry: ManifestObject; bytes: Buffer }>>();

  constructor(objects: readonly Readonly<{ entry: ManifestObject; bytes: Buffer }>[]) {
    objects.forEach((object) => this.add(object));
  }

  add(object: Readonly<{ entry: ManifestObject; bytes: Buffer }>): void {
    this.objects.set(object.entry.sourceKey, object);
  }

  async get(key: string) {
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      metadata: {
        key,
        size: object.bytes.length,
        contentType: this.contentTypeOverrides.get(key) ?? object.entry.contentType,
      },
      body: Readable.toWeb(Readable.from([object.bytes])),
    };
  }
}

class FakeTarget {
  readonly puts: Array<Readonly<{
    key: string;
    size: number;
    contentType: string;
    sha256: string;
    customMetadata: Readonly<{ sha256: string }>;
  }>> = [];
  readonly bytes = new Map<string, Buffer>();
  private readonly metadata = new Map<string, Metadata>();

  seed(key: string, bytes: Buffer, contentType: string, sha256: string): void {
    this.bytes.set(key, bytes);
    this.metadata.set(key, { key, size: bytes.length, contentType, sha256 });
  }

  async head(key: string): Promise<Metadata | null> {
    return this.metadata.get(key) ?? null;
  }

  async putIfAbsent(key: string, input: Readonly<{
    body: ReadableStream<Uint8Array>;
    size: number;
    contentType: string;
    sha256: string;
    customMetadata: Readonly<{ sha256: string }>;
  }>): Promise<Metadata> {
    const existing = this.metadata.get(key);
    if (existing) return existing;
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    this.puts.push({
      key,
      size: input.size,
      contentType: input.contentType,
      sha256: input.sha256,
      customMetadata: input.customMetadata,
    });
    this.bytes.set(key, bytes);
    const metadata = { key, size: bytes.length, contentType: input.contentType, sha256: input.sha256 };
    this.metadata.set(key, metadata);
    return metadata;
  }
}

function image(mediaId: string, variant: "full" | "view", bytes: Buffer) {
  const key = `media/${mediaId}/${variant}.webp`;
  return {
    entry: {
      mediaId,
      variant,
      sourceKey: key,
      targetKey: key,
      byteSize: bytes.length,
      contentType: "image/webp" as const,
    },
    bytes,
  };
}

function audio(mediaId: string, bytes: Buffer, sourceKey = `media/${mediaId}/full.ogg`) {
  return {
    entry: {
      mediaId,
      variant: "full" as const,
      sourceKey,
      targetKey: `media/${mediaId}/full.opus`,
      byteSize: bytes.length,
      contentType: "audio/ogg" as const,
    },
    bytes,
  };
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(26);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8L", 12, "ascii");
  bytes.writeUInt32LE(5, 16);
  bytes[20] = 0x2f;
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes[21] = encodedWidth & 0xff;
  bytes[22] = ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6);
  bytes[23] = (encodedHeight >> 2) & 0xff;
  bytes[24] = (encodedHeight >> 10) & 0x0f;
  return bytes;
}

function oggOpus(): Buffer {
  const bytes = Buffer.alloc(35);
  bytes.write("OggS", 0, "ascii");
  bytes[26] = 0;
  bytes.write("OpusHead", 27, "ascii");
  return bytes;
}

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "infini-r2-copy-test-"));
  temporaryDirectories.push(root);
  return {
    manifest: join(root, "manifest.json"),
    checkpoint: join(root, "checkpoint.json"),
    report: join(root, "report.json"),
  };
}

async function writeManifest(path: string, objects: readonly ManifestObject[]): Promise<void> {
  await writeFile(path, JSON.stringify({ version: 1, objects }), "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function copy(
  workspace: Awaited<ReturnType<typeof createWorkspace>>,
  source: FakeSource,
  target: FakeTarget,
  options: Readonly<{ concurrency?: number; pageSize?: number }> = {},
) {
  return copyR2FromManifest({
    manifestPath: workspace.manifest,
    checkpointPath: workspace.checkpoint,
    reportPath: workspace.report,
    source,
    target,
    ...options,
  });
}
