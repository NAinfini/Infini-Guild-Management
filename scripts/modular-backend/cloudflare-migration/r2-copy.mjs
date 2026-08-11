import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  R2_MIGRATION_VERSION as VERSION,
  R2_SHA256_PATTERN,
  assertOggOpus,
  parseR2Manifest,
  readWebpDimensions,
} from "./r2-copy-contract.mjs";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 4;
const DEFAULT_PAGE_SIZE = 100;

/**
 * Source adapters expose get(key) -> { metadata: { key, size, contentType }, body } | null.
 * Target adapters expose head(key) and atomic putIfAbsent(key, input), both returning
 * { key, size, contentType, sha256 }. putIfAbsent must never overwrite an object.
 */
export async function copyR2FromManifest({
  manifestPath,
  checkpointPath,
  reportPath,
  source,
  target,
  concurrency = DEFAULT_CONCURRENCY,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  assertAdapter(source, ["get"], "source");
  assertAdapter(target, ["head", "putIfAbsent"], "target");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`R2 copy concurrency must be between 1 and ${MAX_CONCURRENCY}`);
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new RangeError("R2 copy page size must be between 1 and 1000");
  }

  const paths = normalizePaths({ manifestPath, checkpointPath, reportPath });
  const manifestBytes = await readFile(paths.manifest);
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const manifest = parseR2Manifest(manifestBytes.toString("utf8"));
  let checkpoint = await readCheckpoint(paths.checkpoint, manifestSha256, manifest.objects);
  const spoolDirectory = await mkdtemp(join(tmpdir(), "infini-r2-copy-"));

  try {
    while (checkpoint.nextIndex < manifest.objects.length) {
      const end = Math.min(checkpoint.nextIndex + pageSize, manifest.objects.length);
      const page = manifest.objects.slice(checkpoint.nextIndex, end);
      const copied = await mapLimited(page, concurrency, (entry) => copyOne(entry, source, target, spoolDirectory));
      checkpoint = {
        version: VERSION,
        manifestSha256,
        nextIndex: end,
        objects: [
          ...checkpoint.objects,
          ...copied.map(({ targetKey, sha256, width, height }) => ({ targetKey, sha256, width, height })),
        ],
      };
      await writeJsonAtomic(paths.checkpoint, checkpoint);
    }

    const objects = manifest.objects.map((entry, index) => ({
      ...entry,
      sha256: checkpoint.objects[index].sha256,
      width: checkpoint.objects[index].width,
      height: checkpoint.objects[index].height,
    }));
    const findings = await reconcile(objects, target, concurrency, pageSize);
    const report = {
      version: VERSION,
      manifestSha256,
      summary: {
        expected: objects.length,
        verified: objects.length - findings.length,
        findings: findings.length,
      },
      objects,
      findings,
    };
    await writeJsonAtomic(paths.report, report);
    if (findings.length > 0) {
      throw new Error(`[conflict] R2 reconciliation found ${findings.length} target object problem(s)`);
    }
    return report;
  } finally {
    await rm(spoolDirectory, { recursive: true, force: true });
  }
}

async function copyOne(entry, source, target, spoolDirectory) {
  const object = await source.get(entry.sourceKey);
  if (!object) throw new Error(`[missing] Source object ${entry.sourceKey} does not exist`);
  const metadata = assertSourceMetadata(object.metadata, entry.sourceKey);
  if (
    metadata.size !== entry.byteSize
    || (metadata.contentType !== null && metadata.contentType !== entry.contentType)
  ) {
    await cancelBody(object.body);
    throw new Error(
      `[conflict] Source metadata for ${entry.sourceKey} does not match manifest size/MIME`,
    );
  }

  const temporaryPath = join(spoolDirectory, randomUUID());
  try {
    const sha256 = await spoolAndHash(object.body, temporaryPath, entry.byteSize, entry.sourceKey);
    if (entry.sha256 && entry.sha256 !== sha256) {
      throw new Error(`[conflict] Source SHA-256 for ${entry.sourceKey} does not match manifest`);
    }
    const bytes = await readFile(temporaryPath);
    let dimensions;
    if (entry.contentType === "image/webp") dimensions = readWebpDimensions(bytes);
    else {
      assertOggOpus(bytes);
      dimensions = { width: null, height: null };
    }
    if (
      entry.width !== undefined
      && (entry.width !== dimensions.width || entry.height !== dimensions.height)
    ) {
      throw new Error(`[conflict] Source dimensions for ${entry.sourceKey} do not match manifest`);
    }

    const expected = {
      key: entry.targetKey,
      size: entry.byteSize,
      contentType: entry.contentType,
      sha256,
    };
    const existing = await target.head(entry.targetKey);
    if (existing) {
      assertTargetMatches(existing, expected);
      return { targetKey: entry.targetKey, sha256, ...dimensions };
    }

    const uploaded = await target.putIfAbsent(entry.targetKey, {
      body: Readable.toWeb(createReadStream(temporaryPath)),
      size: entry.byteSize,
      contentType: entry.contentType,
      sha256,
      customMetadata: { sha256 },
    });
    assertTargetMatches(uploaded, expected);
    return { targetKey: entry.targetKey, sha256, ...dimensions };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function spoolAndHash(body, path, expectedSize, key) {
  const hash = createHash("sha256");
  let size = 0;
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > expectedSize) {
        callback(new Error(`[conflict] Source body size for ${key} exceeds ${expectedSize}`));
        return;
      }
      hash.update(bytes);
      callback(null, bytes);
    },
  });
  await pipeline(toNodeReadable(body, key), hashingStream, createWriteStream(path, { flags: "wx" }));
  if (size !== expectedSize) {
    throw new Error(`[conflict] Source body size for ${key} is ${size}; expected ${expectedSize}`);
  }
  return hash.digest("hex");
}

function toNodeReadable(body, key) {
  if (body instanceof Readable) return body;
  if (body && typeof body.getReader === "function") return Readable.fromWeb(body);
  if (body && (typeof body[Symbol.asyncIterator] === "function" || typeof body[Symbol.iterator] === "function")) {
    return Readable.from(body);
  }
  throw new TypeError(`[unknown] Source object ${key} did not provide a readable body`);
}

async function cancelBody(body) {
  if (body && typeof body.cancel === "function") await body.cancel().catch(() => undefined);
  else if (body && typeof body.destroy === "function") body.destroy();
}

async function reconcile(objects, target, concurrency, pageSize) {
  const findings = [];
  for (let start = 0; start < objects.length; start += pageSize) {
    const page = objects.slice(start, start + pageSize);
    const actual = await mapLimited(page, concurrency, ({ targetKey }) => target.head(targetKey));
    page.forEach((expected, index) => {
      const metadata = actual[index];
      if (!metadata) {
        findings.push({ kind: "missing", targetKey: expected.targetKey });
      } else if (!targetMatches(metadata, {
        key: expected.targetKey,
        size: expected.byteSize,
        contentType: expected.contentType,
        sha256: expected.sha256,
      })) {
        findings.push({
          kind: "conflict",
          targetKey: expected.targetKey,
          expected: {
            byteSize: expected.byteSize,
            contentType: expected.contentType,
            sha256: expected.sha256,
          },
          actual: summarizeTarget(metadata),
        });
      }
    });
  }
  return findings;
}

async function readCheckpoint(path, manifestSha256, objects) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { version: VERSION, manifestSha256, nextIndex: 0, objects: [] };
    }
    throw new TypeError(`R2 copy checkpoint is invalid: ${error.message}`);
  }
  assertRecord(value, "R2 copy checkpoint");
  assertKeys(
    value,
    ["version", "manifestSha256", "nextIndex", "objects"],
    ["version", "manifestSha256", "nextIndex", "objects"],
    "R2 copy checkpoint",
  );
  if (value.version !== VERSION || value.manifestSha256 !== manifestSha256) {
    throw new Error("[conflict] R2 copy checkpoint belongs to a different manifest");
  }
  if (!Number.isSafeInteger(value.nextIndex) || value.nextIndex < 0 || value.nextIndex > objects.length) {
    throw new TypeError("R2 copy checkpoint nextIndex is invalid");
  }
  if (!Array.isArray(value.objects) || value.objects.length !== value.nextIndex) {
    throw new TypeError("R2 copy checkpoint object count is invalid");
  }
  value.objects.forEach((entry, index) => {
    assertRecord(entry, `R2 copy checkpoint object ${index}`);
    assertKeys(
      entry,
      ["targetKey", "sha256", "width", "height"],
      ["targetKey", "sha256", "width", "height"],
      `R2 copy checkpoint object ${index}`,
    );
    const imageDimensionsValid = objects[index].contentType === "image/webp"
      && Number.isSafeInteger(entry.width)
      && entry.width > 0
      && Number.isSafeInteger(entry.height)
      && entry.height > 0;
    const audioDimensionsValid = objects[index].contentType === "audio/ogg"
      && entry.width === null
      && entry.height === null;
    if (
      entry.targetKey !== objects[index].targetKey
      || typeof entry.sha256 !== "string"
      || !R2_SHA256_PATTERN.test(entry.sha256)
      || (objects[index].sha256 && objects[index].sha256 !== entry.sha256)
      || (objects[index].width !== undefined && objects[index].width !== entry.width)
      || (objects[index].height !== undefined && objects[index].height !== entry.height)
      || (!imageDimensionsValid && !audioDimensionsValid)
    ) {
      throw new Error(`[conflict] R2 copy checkpoint object ${index} does not match the manifest`);
    }
  });
  return value;
}

function assertSourceMetadata(metadata, key) {
  assertRecord(metadata, `Source metadata for ${key}`);
  const contentType = metadata.contentType ?? null;
  if (
    metadata.key !== key
    || !Number.isSafeInteger(metadata.size)
    || metadata.size < 0
    || (contentType !== null && typeof contentType !== "string")
  ) {
    throw new TypeError(`[unknown] Source metadata for ${key} is invalid`);
  }
  return { ...metadata, contentType };
}

function assertTargetMatches(metadata, expected) {
  if (!targetMatches(metadata, expected)) {
    throw new Error(`[conflict] Target object ${expected.key} already exists with different metadata`);
  }
}

function targetMatches(metadata, expected) {
  return Boolean(metadata)
    && metadata.key === expected.key
    && metadata.size === expected.size
    && metadata.contentType === expected.contentType
    && metadata.sha256 === expected.sha256;
}

function summarizeTarget(metadata) {
  return {
    key: typeof metadata?.key === "string" ? metadata.key : null,
    size: Number.isSafeInteger(metadata?.size) ? metadata.size : null,
    contentType: typeof metadata?.contentType === "string" ? metadata.contentType : null,
    sha256: typeof metadata?.sha256 === "string" ? metadata.sha256 : null,
  };
}

async function mapLimited(items, concurrency, map) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index], index);
    }
  }));
  return results;
}

function normalizePaths({ manifestPath, checkpointPath, reportPath }) {
  const values = [manifestPath, checkpointPath, reportPath];
  if (values.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new TypeError("manifestPath, checkpointPath, and reportPath are required");
  }
  const [manifest, checkpoint, report] = values.map((value) => resolve(value));
  if (new Set([manifest, checkpoint, report]).size !== 3) {
    throw new TypeError("manifestPath, checkpointPath, and reportPath must be different files");
  }
  return { manifest, checkpoint, report };
}

function assertAdapter(adapter, methods, name) {
  if (!adapter || methods.some((method) => typeof adapter[method] !== "function")) {
    throw new TypeError(`R2 ${name} adapter must implement ${methods.join(" and ")}`);
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertKeys(value, allowed, required, label) {
  const keys = Object.keys(value);
  const unknown = keys.find((key) => !allowed.includes(key));
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (unknown) throw new TypeError(`[unknown] ${label} contains field ${unknown}`);
  if (missing) throw new TypeError(`${label} is missing field ${missing}`);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
