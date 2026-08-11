import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  R2_MIGRATION_VERSION as VERSION,
  R2_SHA256_PATTERN,
  assertSafeR2Key,
  normalizeR2ManifestObject,
  parseR2Manifest,
} from "./r2-copy-contract.mjs";

const MAX_CONCURRENCY = 4;
const DEFAULT_PAGE_SIZE = 100;
const INVENTORY_PAGE_SIZE = 1_000;

export async function inventoryR2ViaWorker({ reportPath, endpoint, token, fetchImpl = fetch }) {
  if (typeof reportPath !== "string" || reportPath.trim() === "") throw new TypeError("reportPath is required");
  const baseUrl = normalizeEndpoint(endpoint);
  if (typeof token !== "string" || token.length < 32) throw new TypeError("R2 copy bearer token is missing or too short");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const [source, target] = await Promise.all([
    inventoryAll(baseUrl, "source", token, fetchImpl),
    inventoryAll(baseUrl, "target", token, fetchImpl),
  ]);
  const report = {
    version: VERSION,
    source: { count: source.length, objects: source },
    target: { count: target.length, objects: target },
  };
  await writeJsonAtomic(resolve(reportPath), report);
  return report;
}

export async function copyR2ViaWorker({
  manifestPath,
  checkpointPath,
  reportPath,
  endpoint,
  token,
  concurrency = MAX_CONCURRENCY,
  pageSize = DEFAULT_PAGE_SIZE,
  fetchImpl = fetch,
}) {
  const paths = normalizePaths({ manifestPath, checkpointPath, reportPath });
  const baseUrl = normalizeEndpoint(endpoint);
  if (typeof token !== "string" || token.length < 32) throw new TypeError("R2 copy bearer token is missing or too short");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`R2 copy concurrency must be between 1 and ${MAX_CONCURRENCY}`);
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new RangeError("R2 copy page size must be between 1 and 1000");
  }

  const manifestBytes = await readFile(paths.manifest);
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const manifest = parseR2Manifest(manifestBytes.toString("utf8"));
  const sourceObjects = await inventoryAll(baseUrl, "source", token, fetchImpl);
  const sourceInventory = reconcileSourceInventory(manifest.objects, sourceObjects);
  const sourceBlockers = sourceInventory.objects.filter(({ classification }) => classification === "unknown")
    .map(({ key }) => ({ kind: "unknown_source", key }));
  sourceBlockers.push(...sourceInventory.missing.map((key) => ({ kind: "missing_source", key })));
  sourceBlockers.push(...sourceInventory.conflicts.map((key) => ({ kind: "source_metadata_conflict", key })));
  if (sourceBlockers.length > 0) {
    const report = inventoryFailureReport(manifestSha256, manifest.objects, sourceInventory, sourceBlockers);
    await writeJsonAtomic(paths.report, report);
    throw new Error(`[conflict] Source inventory has ${sourceBlockers.length} blocking finding(s)`);
  }

  let checkpoint = await readCheckpoint(paths.checkpoint, manifestSha256, manifest.objects);
  while (checkpoint.nextIndex < manifest.objects.length) {
    const end = Math.min(checkpoint.nextIndex + pageSize, manifest.objects.length);
    const page = manifest.objects.slice(checkpoint.nextIndex, end);
    const copied = await mapLimited(page, concurrency, (entry) => copyOne(baseUrl, token, entry, fetchImpl));
    checkpoint = {
      version: VERSION,
      manifestSha256,
      nextIndex: end,
      objects: [...checkpoint.objects, ...copied.map(checkpointObject)],
    };
    await writeJsonAtomic(paths.checkpoint, checkpoint);
  }

  const objects = manifest.objects.map((entry, index) => ({ ...entry, ...checkpoint.objects[index] }));
  const headFindings = await reconcileHeads(baseUrl, token, objects, concurrency, pageSize, fetchImpl);
  const targetObjects = await inventoryAll(baseUrl, "target", token, fetchImpl);
  const expectedTargets = new Set(objects.map(({ targetKey }) => targetKey));
  const targetUnknown = targetObjects
    .filter(({ key }) => !expectedTargets.has(key))
    .map(({ key }) => ({ kind: "unknown_target", key }));
  const findings = [...headFindings, ...targetUnknown];
  const warnings = sourceInventory.objects
    .filter(({ classification, metadataStatus }) => (
      classification === "orphan"
      || classification === "separate_preserve"
      || metadataStatus === "normalized"
    ))
    .map(({ key, classification, metadataStatus }) => ({
      kind: metadataStatus === "normalized" ? "normalized_source_content_type" : classification,
      key,
    }));
  const report = {
    version: VERSION,
    manifestSha256,
    phase: findings.length === 0 ? "complete" : "reconciliation_failed",
    summary: {
      expected: objects.length,
      verified: objects.length - headFindings.length,
      findings: findings.length,
      warnings: warnings.length,
    },
    sourceInventory,
    targetInventory: {
      scanned: targetObjects.length,
      expected: targetObjects.length - targetUnknown.length,
      unknown: targetUnknown.length,
    },
    objects,
    warnings,
    findings,
  };
  await writeJsonAtomic(paths.report, report);
  if (findings.length > 0) throw new Error(`[conflict] R2 reconciliation found ${findings.length} problem(s)`);
  return report;
}

async function copyOne(baseUrl, token, entry, fetchImpl) {
  let result;
  try {
    result = await requestJson(fetchImpl, new URL("copy", baseUrl), {
      method: "POST",
      headers: authorization(token, { "content-type": "application/json" }),
      body: JSON.stringify(entry),
      redirect: "error",
    });
  } catch (error) {
    throw new Error(`R2 copy failed for ${entry.mediaId}/${entry.variant}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (
    result.version !== VERSION
    || (result.status !== "created" && result.status !== "existing")
    || typeof result.sourceContentTypeNormalized !== "boolean"
  ) {
    throw new Error("R2 copy helper returned an invalid response envelope");
  }
  const object = normalizeR2ManifestObject(result.object, "R2 copy response object");
  assertSamePlannedObject(entry, object);
  if (!object.sha256 || !R2_SHA256_PATTERN.test(object.sha256)) throw new Error("R2 copy response omitted SHA-256");
  if (object.contentType === "image/webp" && (!object.width || !object.height)) {
    throw new Error("R2 copy response omitted image dimensions");
  }
  return object;
}

async function reconcileHeads(baseUrl, token, objects, concurrency, pageSize, fetchImpl) {
  const findings = [];
  for (let start = 0; start < objects.length; start += pageSize) {
    const page = objects.slice(start, start + pageSize);
    const statuses = await mapLimited(page, concurrency, async (object) => {
      const url = new URL("object", baseUrl);
      url.search = new URLSearchParams({
        targetKey: object.targetKey,
        byteSize: String(object.byteSize),
        contentType: object.contentType,
        sha256: object.sha256,
      }).toString();
      try {
        return await fetchImpl(url, {
          method: "HEAD",
          headers: authorization(token),
          redirect: "error",
        });
      } catch (error) {
        return { status: 0, error: error instanceof Error ? error.message : "request failed" };
      }
    });
    page.forEach((object, index) => {
      const result = statuses[index];
      if (result.status === 200) {
        if (
          result.headers.get("content-length") !== String(object.byteSize)
          || result.headers.get("content-type") !== object.contentType
          || result.headers.get("x-content-sha256") !== object.sha256
        ) {
          findings.push({ kind: "head_metadata_conflict", key: object.targetKey });
        }
      } else {
        findings.push({
          kind: result.status === 404 ? "missing_target" : "head_failed",
          key: object.targetKey,
          status: result.status,
        });
      }
    });
  }
  return findings;
}

async function inventoryAll(baseUrl, side, token, fetchImpl) {
  const objects = [];
  const keys = new Set();
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL(`inventory/${side}`, baseUrl);
    url.searchParams.set("limit", String(INVENTORY_PAGE_SIZE));
    url.searchParams.set("prefix", "");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await requestJson(fetchImpl, url, {
      method: "GET",
      headers: authorization(token),
      redirect: "error",
    });
    if (page.version !== VERSION || !Array.isArray(page.objects)) {
      throw new Error(`R2 ${side} inventory returned an invalid page`);
    }
    if (page.objects.length > INVENTORY_PAGE_SIZE) throw new Error(`R2 ${side} inventory exceeded page size`);
    for (const object of page.objects) {
      const normalized = normalizeInventoryObject(object, side);
      if (keys.has(normalized.key)) throw new Error(`[conflict] R2 ${side} inventory repeated ${normalized.key}`);
      keys.add(normalized.key);
      objects.push(normalized);
    }
    if (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length < 1 || page.nextCursor.length > 4_096)) {
      throw new Error(`R2 ${side} inventory returned an invalid cursor`);
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error(`[conflict] R2 ${side} inventory cursor repeated`);
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return objects;
}

function reconcileSourceInventory(manifest, inventory) {
  const references = new Map();
  for (const entry of manifest) {
    const sourceByteSize = entry.sourceByteSize ?? entry.byteSize;
    const sourceContentType = entry.sourceContentType ?? entry.contentType;
    const existing = references.get(entry.sourceKey);
    if (existing && (existing.sourceByteSize !== sourceByteSize || existing.sourceContentType !== sourceContentType)) {
      throw new Error(`[conflict] Manifest assigns inconsistent metadata to ${entry.sourceKey}`);
    }
    references.set(entry.sourceKey, { ...entry, sourceByteSize, sourceContentType });
  }
  const knownPrefixes = new Set([...references.keys()].map((key) => key.split("/", 1)[0]));
  const found = new Set();
  const conflicts = [];
  const objects = inventory.map((object) => {
    const expected = references.get(object.key);
    if (expected) {
      found.add(object.key);
      if (
        object.size !== expected.sourceByteSize
        || (object.contentType !== null && object.contentType !== expected.sourceContentType)
      ) conflicts.push(object.key);
      return {
        ...object,
        classification: "referenced",
        metadataStatus: object.contentType === null ? "normalized" : "matched",
      };
    }
    if (object.key.startsWith("audit-archive/")) return { ...object, classification: "separate_preserve" };
    const prefix = object.key.split("/", 1)[0];
    return { ...object, classification: knownPrefixes.has(prefix) ? "orphan" : "unknown" };
  });
  return {
    scanned: objects.length,
    referenced: objects.filter(({ classification }) => classification === "referenced").length,
    orphan: objects.filter(({ classification }) => classification === "orphan").length,
    separatePreserve: objects.filter(({ classification }) => classification === "separate_preserve").length,
    normalized: objects.filter(({ metadataStatus }) => metadataStatus === "normalized").length,
    unknown: objects.filter(({ classification }) => classification === "unknown").length,
    missing: [...references.keys()].filter((key) => !found.has(key)),
    conflicts,
    objects,
  };
}

function normalizeInventoryObject(object, side) {
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error(`R2 ${side} inventory object is invalid`);
  assertSafeR2Key(object.key, `R2 ${side} inventory key`);
  if (!Number.isSafeInteger(object.size) || object.size < 0) throw new Error(`R2 ${side} inventory size is invalid`);
  if (object.contentType !== null && typeof object.contentType !== "string") throw new Error(`R2 ${side} inventory MIME is invalid`);
  if (typeof object.etag !== "string" || object.etag.length < 1) throw new Error(`R2 ${side} inventory etag is invalid`);
  if (!object.customMetadata || typeof object.customMetadata !== "object" || Array.isArray(object.customMetadata)) {
    throw new Error(`R2 ${side} inventory custom metadata is invalid`);
  }
  if (object.checksum !== null && (typeof object.checksum !== "string" || !R2_SHA256_PATTERN.test(object.checksum))) {
    throw new Error(`R2 ${side} inventory checksum is invalid`);
  }
  return {
    key: object.key,
    size: object.size,
    contentType: object.contentType,
    etag: object.etag,
    customMetadata: object.customMetadata,
    checksum: object.checksum,
  };
}

async function requestJson(fetchImpl, url, init) {
  const result = await fetchImpl(url, init);
  if (!result.ok) {
    const payload = await result.json().catch(() => null);
    const detail = payload && typeof payload === "object" && typeof payload.error === "string"
      ? `: ${payload.error}`
      : "";
    throw new Error(`R2 copy helper request failed with HTTP ${result.status}${detail}`);
  }
  try {
    return await result.json();
  } catch {
    throw new Error("R2 copy helper returned invalid JSON");
  }
}

function assertSamePlannedObject(expected, actual) {
  for (const key of ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType"]) {
    if (actual[key] !== expected[key]) throw new Error(`R2 copy response changed planned field ${key}`);
  }
  if (expected.sha256 && actual.sha256 !== expected.sha256) throw new Error("R2 copy response changed planned SHA-256");
  if (expected.width !== undefined && (actual.width !== expected.width || actual.height !== expected.height)) {
    throw new Error("R2 copy response changed planned dimensions");
  }
}

function checkpointObject(object) {
  return {
    targetKey: object.targetKey,
    sha256: object.sha256,
    width: object.width,
    height: object.height,
  };
}

async function readCheckpoint(path, manifestSha256, manifest) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return { version: VERSION, manifestSha256, nextIndex: 0, objects: [] };
    throw new TypeError(`R2 copy checkpoint is invalid: ${error.message}`);
  }
  if (
    !value
    || typeof value !== "object"
    || value.version !== VERSION
    || value.manifestSha256 !== manifestSha256
    || !Number.isSafeInteger(value.nextIndex)
    || value.nextIndex < 0
    || value.nextIndex > manifest.length
    || !Array.isArray(value.objects)
    || value.objects.length !== value.nextIndex
  ) {
    throw new Error("[conflict] R2 copy checkpoint does not match the manifest");
  }
  value.objects.forEach((object, index) => {
    if (
      !object
      || object.targetKey !== manifest[index].targetKey
      || typeof object.sha256 !== "string"
      || !R2_SHA256_PATTERN.test(object.sha256)
      || (manifest[index].sha256 && manifest[index].sha256 !== object.sha256)
      || (manifest[index].contentType === "image/webp"
        ? !Number.isSafeInteger(object.width) || object.width < 1 || !Number.isSafeInteger(object.height) || object.height < 1
        : object.width !== null || object.height !== null)
    ) {
      throw new Error(`[conflict] R2 copy checkpoint object ${index} does not match the manifest`);
    }
  });
  return value;
}

function inventoryFailureReport(manifestSha256, objects, sourceInventory, findings) {
  return {
    version: VERSION,
    manifestSha256,
    phase: "source_inventory_failed",
    summary: { expected: objects.length, verified: 0, findings: findings.length, warnings: 0 },
    sourceInventory,
    targetInventory: null,
    objects: [],
    warnings: [],
    findings,
  };
}

function authorization(token, extra = {}) {
  return { "x-infini-migration-token": token, ...extra };
}

function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("R2 copy endpoint must be a valid URL");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev") || url.pathname !== "/") {
    throw new TypeError("R2 copy endpoint must be an HTTPS workers.dev origin");
  }
  url.search = "";
  url.hash = "";
  return url;
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

function parseCli(argv) {
  const allowed = new Set(["manifest", "checkpoint", "report", "endpoint", "token-env", "concurrency", "page-size"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || !allowed.has(flag.slice(2))) throw new TypeError("Invalid CLI arguments");
    values[flag.slice(2)] = value;
  }
  for (const required of ["manifest", "checkpoint", "report", "endpoint"]) {
    if (!values[required]) throw new TypeError(`--${required} is required`);
  }
  return values;
}

async function runCli() {
  const args = parseCli(process.argv.slice(2));
  const tokenEnvironment = args["token-env"] ?? "IG_R2_MIGRATION_TOKEN";
  const report = await copyR2ViaWorker({
    manifestPath: args.manifest,
    checkpointPath: args.checkpoint,
    reportPath: args.report,
    endpoint: args.endpoint,
    token: process.env[tokenEnvironment],
    ...(args.concurrency ? { concurrency: Number(args.concurrency) } : {}),
    ...(args["page-size"] ? { pageSize: Number(args["page-size"]) } : {}),
  });
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R2 copy failed"}\n`);
    process.exitCode = 1;
  });
}
