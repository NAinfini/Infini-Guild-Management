import {
  assertBlobPutInput,
  assertBlobPutMatches,
  type BlobMetadata,
  type BlobPutInput,
  type BlobRange,
  type BlobRead,
  type BlobStore,
} from "@guild/kernel";
import { R2BlobStore } from "../src/adapters/public.js";
import {
  DEVELOPMENT_MEDIA_DATABASE_STATEMENTS,
  DEVELOPMENT_MEDIA_DATABASE_PREFLIGHT_STATEMENT,
  assertDevelopmentMediaDatabasePreflight,
  seedDevelopmentMediaObjects,
} from "../../../scripts/dev/media-fixtures.mjs";
import { Miniflare } from "miniflare";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type CloudflareLocalMediaSeedOptions = Readonly<{
  persistTo: string;
  databaseId: string;
  bucketName: string;
}>;

export type CloudflareLocalMediaSeedResult = Readonly<{
  result: "applied" | "skipped";
  media: Readonly<{ processed: number; total: number }> | null;
}>;

/** Seeds only the local Miniflare D1/R2 state passed by cloudflare-local.mjs. */
export async function seedCloudflareLocalMedia(
  options: CloudflareLocalMediaSeedOptions,
): Promise<CloudflareLocalMediaSeedResult> {
  const persistTo = path.resolve(options.persistTo);
  const miniflare = new Miniflare({
    resourcePersistencePath: path.join(persistTo, "v3"),
    workers: [{
      config: {
        name: "local-media-seed",
        type: "worker",
        compatibilityDate: "2026-07-28",
        manifest: {
          mainModule: "script-0.mjs",
          modules: {
            "script-0.mjs": { type: "esm", contents: "export default {}" },
          },
        },
        env: {
          DB: { type: "d1", id: options.databaseId },
          BLOBS: { type: "r2", name: options.bucketName },
        },
      },
    }],
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const owner = await database.prepare("SELECT count(*) AS count FROM users WHERE id = 'dev-owner'")
      .first<{ count: number }>();
    if (owner?.count !== 1) return Object.freeze({ result: "skipped", media: null });

    assertDevelopmentMediaDatabasePreflight(await database.prepare(
      DEVELOPMENT_MEDIA_DATABASE_PREFLIGHT_STATEMENT,
    ).first());
    const blobs = new MiniflareR2BlobStore(await miniflare.getR2Bucket("BLOBS"));
    const media = await seedDevelopmentMediaObjects(blobs);
    await database.batch(DEVELOPMENT_MEDIA_DATABASE_STATEMENTS.map((statement) => database.prepare(statement)));
    return Object.freeze({
      result: "applied",
      media,
    });
  } finally {
    await miniflare.dispose();
  }
}

/** Node-side Miniflare requires a known-length value rather than a generic stream. */
class MiniflareR2BlobStore implements BlobStore {
  private readonly reads: R2BlobStore;

  constructor(private readonly bucket: MiniflareR2Bucket) {
    this.reads = new R2BlobStore(bucket as unknown as R2Bucket, () => {
      throw new Error("Buffered local R2 writes do not use FixedLengthStream");
    });
  }

  async putIfAbsent(key: string, input: BlobPutInput): Promise<BlobMetadata> {
    assertBlobPutInput(input);
    const existing = await this.reads.head(key);
    if (existing) {
      await input.body.cancel().catch(() => undefined);
      assertBlobPutMatches(existing, key, input);
      return existing;
    }

    const bytes = await readExactBytes(input.body, input.size);
    await this.bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input.contentType },
      customMetadata: { sha256: input.sha256 },
    });
    const written = await this.reads.head(key);
    if (!written) throw new Error(`Local R2 write for ${key} did not produce an object`);
    assertBlobPutMatches(written, key, input);
    return written;
  }

  get(key: string, range?: BlobRange): Promise<BlobRead | null> {
    return this.reads.get(key, range);
  }

  head(key: string): Promise<BlobMetadata | null> {
    return this.reads.head(key);
  }

  delete(key: string | readonly string[]): Promise<void> {
    return this.reads.delete(key);
  }
}

type MiniflareR2Bucket = Awaited<ReturnType<Miniflare["getR2Bucket"]>>;

async function readExactBytes(body: ReadableStream<Uint8Array>, expectedSize: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(expectedSize);
  const reader = body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedSize) throw new RangeError("Blob body exceeds its declared size");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedSize) throw new RangeError("Blob body does not match its declared size");
  return bytes;
}

export function parseCloudflareLocalMediaSeedArguments(args: readonly string[]): CloudflareLocalMediaSeedOptions {
  if (
    args.length !== 6
    || args[0] !== "--persist-to" || !args[1]?.trim()
    || args[2] !== "--database-id" || !args[3]?.trim()
    || args[4] !== "--bucket-name" || !args[5]?.trim()
  ) {
    throw new TypeError(
      "Usage: seed-local-media --persist-to <local-state-directory> --database-id <database-id> --bucket-name <bucket-name>",
    );
  }
  return Object.freeze({
    persistTo: args[1],
    databaseId: args[3],
    bucketName: args[5],
  });
}

const isMainModule = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const result = await seedCloudflareLocalMedia(parseCloudflareLocalMediaSeedArguments(process.argv.slice(2)));
    console.info(`Cloudflare local media seed ${result.result}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Cloudflare local media seed failed");
    process.exitCode = 1;
  }
}
