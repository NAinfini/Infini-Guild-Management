import {
  SHA256_HEX_PATTERN,
  assertBlobKey,
  assertBlobInventoryRequest,
  assertBlobPutInput,
  assertBlobPutMatches,
  normalizeBlobRange,
  type BlobInventory,
  type BlobInventoryPage,
  type BlobInventoryRequest,
  type BlobMetadata,
  type BlobPutInput,
  type BlobRange,
  type BlobRead,
  type BlobStore,
} from "@guild/kernel";

function sha256Bytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function metadataFromObject(key: string, object: R2Object): BlobMetadata {
  const customSha256 = object.customMetadata?.sha256;
  const checksumSha256 = object.checksums.toJSON().sha256;
  if (customSha256 !== undefined && checksumSha256 !== undefined && customSha256 !== checksumSha256) {
    throw new Error(`R2 object ${key} failed sha256 integrity validation: metadata and checksum disagree`);
  }
  const sha256 = customSha256 ?? checksumSha256;
  if (!sha256 || !SHA256_HEX_PATTERN.test(sha256)) {
    throw new Error(`R2 object ${key} is missing its canonical sha256`);
  }
  return {
    key,
    size: object.size,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    sha256,
    etag: object.etag,
    lastModified: object.uploaded.toISOString(),
  };
}

export type FixedLengthStreamPair = Readonly<{
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}>;

export type FixedLengthStreamFactory = (expectedLength: number) => FixedLengthStreamPair;

function cloudflareFixedLengthStream(expectedLength: number): FixedLengthStreamPair {
  const stream = new FixedLengthStream(expectedLength);
  return {
    readable: stream.readable,
    writable: stream.writable as WritableStream<Uint8Array>,
  };
}

function hasBody(object: R2ObjectBody | R2Object): object is R2ObjectBody {
  return "body" in object;
}

export class R2BlobStore implements BlobStore, BlobInventory {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly fixedLengthStream: FixedLengthStreamFactory = cloudflareFixedLengthStream,
  ) {}

  async putIfAbsent(key: string, input: BlobPutInput): Promise<BlobMetadata> {
    assertBlobKey(key);
    assertBlobPutInput(input);
    const existing = await this.head(key);
    if (existing) {
      await input.body.cancel().catch(() => undefined);
      assertBlobPutMatches(existing, key, input);
      return existing;
    }

    const fixed = this.fixedLengthStream(input.size);
    const abort = new AbortController();
    const upload = this.bucket.put(key, fixed.readable, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input.contentType },
      customMetadata: { sha256: input.sha256 },
      sha256: sha256Bytes(input.sha256),
    });
    const piping = input.body.pipeTo(fixed.writable, { signal: abort.signal });
    let object: R2Object | null;
    try {
      object = await upload;
    } catch (uploadError) {
      abort.abort(uploadError);
      try {
        await piping;
      } catch (pipingError) {
        throw new AggregateError([uploadError, pipingError], "R2 upload and fixed-length stream both failed");
      }
      throw uploadError;
    }
    if (!object) {
      abort.abort();
      await piping.catch(() => undefined);
      const winner = await this.head(key);
      if (!winner) throw new Error(`R2 conditional write for ${key} lost without an existing object`);
      assertBlobPutMatches(winner, key, input);
      return winner;
    }
    await piping;
    if (object.size !== input.size) throw new Error("R2 returned an invalid object size");
    return {
      ...metadataFromObject(key, object),
      contentType: input.contentType,
      sha256: input.sha256,
    };
  }

  async head(key: string): Promise<BlobMetadata | null> {
    assertBlobKey(key);
    const object = await this.bucket.head(key);
    return object ? metadataFromObject(key, object) : null;
  }

  async get(key: string, requestedRange?: BlobRange): Promise<BlobRead | null> {
    assertBlobKey(key);
    const object = await this.bucket.get(key, requestedRange ? { range: requestedRange } : undefined);
    if (!object) return null;
    if (!hasBody(object)) throw new Error(`R2 object ${key} did not include a body`);
    const metadata = metadataFromObject(key, object);
    let range: BlobRange | undefined;
    try {
      range = requestedRange ? normalizeBlobRange(requestedRange, metadata.size) : undefined;
    } catch (error) {
      await object.body.cancel().catch(() => undefined);
      throw error;
    }
    return {
      metadata,
      body: object.body,
      ...(range ? { range: { ...range, total: metadata.size } } : {}),
    };
  }

  async delete(keyOrKeys: string | readonly string[]): Promise<void> {
    const keys = typeof keyOrKeys === "string" ? [keyOrKeys] : [...keyOrKeys];
    keys.forEach(assertBlobKey);
    if (keys.length === 0) return;
    await this.bucket.delete(keys.length === 1 ? keys[0]! : keys);
  }

  async listPrefix(request: BlobInventoryRequest): Promise<BlobInventoryPage> {
    assertBlobInventoryRequest(request);
    const page = await this.bucket.list({
      prefix: request.prefix,
      limit: request.limit,
      ...(request.checkpoint ? { cursor: request.checkpoint } : {}),
      include: ["httpMetadata", "customMetadata"],
    });
    if (page.truncated && !page.cursor) throw new Error("R2 inventory page is truncated without a checkpoint");
    const objects = page.objects.map((object) => {
      if (!object.key.startsWith(request.prefix)) throw new Error("R2 inventory returned an object outside its prefix");
      return metadataFromObject(object.key, object);
    });
    if (objects.length > request.limit) throw new Error("R2 inventory exceeded its requested page size");
    return {
      objects,
      nextCheckpoint: page.truncated ? page.cursor! : null,
    };
  }
}
