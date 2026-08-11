import {
  R2_MAX_OBJECT_BYTES,
  R2_MIGRATION_VERSION,
  R2_SHA256_PATTERN,
  assertOggOpus,
  assertSafeR2Key,
  normalizeR2ManifestObject,
  readWebpDimensions,
} from "./r2-copy-contract.mjs";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_INVENTORY_LIMIT = 1_000;

export default {
  async fetch(request, env) {
    try {
      assertBindings(env);
      if (!isAuthorized(request, env.MIGRATION_ACCESS_KEY)) return response(null, 401);
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/copy") {
        const entry = normalizeR2ManifestObject(await readLimitedJson(request), "R2 copy request");
        return response(await copyObject(entry, env), 200);
      }
      if (request.method === "HEAD" && url.pathname === "/object") {
        return headObject(url, env.TARGET);
      }
      if (request.method === "PUT" && url.pathname === "/object") {
        return response(await uploadObject(request, env.TARGET), 200);
      }
      if (request.method === "GET" && (url.pathname === "/inventory/source" || url.pathname === "/inventory/target")) {
        const bucket = url.pathname.endsWith("/source") ? env.SOURCE : env.TARGET;
        return response(await inventory(url, bucket), 200);
      }
      return response({ error: "not_found" }, 404);
    } catch (error) {
      const status = error instanceof MigrationHttpError
        ? error.status
        : error instanceof TypeError || error instanceof RangeError
          ? 400
          : 500;
      return response({ error: status === 500 ? "migration_helper_failed" : error.message }, status);
    }
  },
};

async function copyObject(entry, env) {
  const expected = {
    key: entry.targetKey,
    size: entry.byteSize,
    contentType: entry.contentType,
    sha256: entry.sha256,
  };
  if (entry.pretransformed === true) {
    const existing = await env.TARGET.head(entry.targetKey);
    if (!existing) throw new MigrationHttpError(409, `[missing] Pretransformed target ${entry.targetKey} does not exist`);
    assertTarget(existing, expected);
    return copyResponse(entry, entry.sha256, { width: entry.width, height: entry.height }, "existing", false);
  }
  const source = await env.SOURCE.get(entry.sourceKey);
  if (!source) throw new MigrationHttpError(404, `[missing] Source object ${entry.sourceKey} does not exist`);
  const sourceContentType = source.httpMetadata?.contentType ?? null;
  if (source.size !== (entry.sourceByteSize ?? entry.byteSize) || (sourceContentType !== null && sourceContentType !== (entry.sourceContentType ?? entry.contentType))) {
    await source.body.cancel().catch(() => undefined);
    throw new MigrationHttpError(409, `[conflict] Source metadata for ${entry.sourceKey} does not match manifest`);
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.byteLength !== entry.byteSize || bytes.byteLength > R2_MAX_OBJECT_BYTES) {
    throw new MigrationHttpError(409, `[conflict] Source body size for ${entry.sourceKey} does not match manifest`);
  }
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (entry.sha256 && entry.sha256 !== sha256) {
    throw new MigrationHttpError(409, `[conflict] Source SHA-256 for ${entry.sourceKey} does not match manifest`);
  }
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
    throw new MigrationHttpError(409, `[conflict] Source dimensions for ${entry.sourceKey} do not match manifest`);
  }

  expected.sha256 = sha256;
  const status = await putTarget(env.TARGET, expected, bytes);
  return copyResponse(entry, sha256, dimensions, status, sourceContentType === null);
}

async function uploadObject(request, bucket) {
  const targetKey = requiredHeader(request, "x-infini-object-key");
  const contentType = requiredHeader(request, "content-type");
  const byteSize = integer(requiredHeader(request, "content-length"), "content-length", 1, R2_MAX_OBJECT_BYTES);
  const sha256 = requiredHeader(request, "x-infini-content-sha256");
  const width = integer(requiredHeader(request, "x-infini-image-width"), "image width", 1, 100_000);
  const height = integer(requiredHeader(request, "x-infini-image-height"), "image height", 1, 100_000);
  assertCanonicalTarget(targetKey, contentType);
  if (contentType !== "image/webp") throw new TypeError("Pretransformed upload must be image/webp");
  if (!R2_SHA256_PATTERN.test(sha256)) throw new TypeError("sha256 is invalid");
  const bytes = await readExactBytes(request, byteSize);
  const actualSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (actualSha256 !== sha256) throw new MigrationHttpError(409, "[conflict] Pretransformed upload SHA-256 differs");
  const dimensions = readWebpDimensions(bytes);
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new MigrationHttpError(409, "[conflict] Pretransformed upload dimensions differ");
  }
  const status = await putTarget(bucket, { key: targetKey, size: byteSize, contentType, sha256 }, bytes);
  return { version: R2_MIGRATION_VERSION, status, object: { targetKey, byteSize, contentType, sha256, width, height } };
}

async function putTarget(bucket, expected, bytes) {
  const existing = await bucket.head(expected.key);
  if (existing) {
    assertTarget(existing, expected);
    return "existing";
  }
  const created = await bucket.put(expected.key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: expected.contentType },
    customMetadata: { sha256: expected.sha256 },
    sha256: sha256Bytes(expected.sha256),
  });
  const actual = created ?? await bucket.head(expected.key);
  if (!actual) throw new MigrationHttpError(409, `[conflict] Target conditional write for ${expected.key} has no winner`);
  assertTarget(actual, expected);
  return created ? "created" : "existing";
}

async function headObject(url, bucket) {
  const targetKey = required(url, "targetKey");
  const contentType = required(url, "contentType");
  const byteSize = integer(required(url, "byteSize"), "byteSize", 1, R2_MAX_OBJECT_BYTES);
  const sha256 = required(url, "sha256");
  assertCanonicalTarget(targetKey, contentType);
  if (!R2_SHA256_PATTERN.test(sha256)) throw new TypeError("sha256 is invalid");

  const object = await bucket.head(targetKey);
  if (!object) return response(null, 404);
  try {
    assertTarget(object, { key: targetKey, size: byteSize, contentType, sha256 });
  } catch {
    return response(null, 409);
  }
  return response(null, 200, {
    "content-length": String(byteSize),
    "content-type": contentType,
    "x-content-sha256": sha256,
  });
}

async function inventory(url, bucket) {
  const limit = integer(url.searchParams.get("limit") ?? "1000", "limit", 1, MAX_INVENTORY_LIMIT);
  const prefix = url.searchParams.get("prefix") ?? "";
  const cursor = url.searchParams.get("cursor") ?? undefined;
  assertInventoryPrefix(prefix);
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 4_096)) {
    throw new TypeError("inventory cursor is invalid");
  }
  const page = await bucket.list({
    limit,
    prefix,
    ...(cursor ? { cursor } : {}),
    include: ["httpMetadata", "customMetadata"],
  });
  if (page.objects.length > limit) throw new Error("R2 inventory exceeded its requested page size");
  if (page.truncated && !page.cursor) throw new Error("R2 inventory is truncated without a cursor");
  const objects = page.objects.map((object) => {
    assertSafeR2Key(object.key, "R2 inventory key");
    if (!object.key.startsWith(prefix)) throw new Error("R2 inventory returned an object outside its prefix");
    const checksums = object.checksums?.toJSON?.() ?? {};
    return {
      key: object.key,
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? null,
      etag: object.etag,
      customMetadata: object.customMetadata ?? {},
      checksum: typeof checksums.sha256 === "string" ? checksums.sha256 : null,
    };
  });
  return {
    version: R2_MIGRATION_VERSION,
    objects,
    nextCursor: page.truncated ? page.cursor : null,
  };
}

function copyResponse(entry, sha256, dimensions, status, sourceContentTypeNormalized) {
  return {
    version: R2_MIGRATION_VERSION,
    status,
    sourceContentTypeNormalized,
    object: { ...entry, sha256, ...dimensions },
  };
}

function assertTarget(object, expected) {
  const sha256 = object.customMetadata?.sha256;
  if (
    object.key !== expected.key
    || object.size !== expected.size
    || object.httpMetadata?.contentType !== expected.contentType
    || sha256 !== expected.sha256
  ) {
    throw new MigrationHttpError(409, `[conflict] Target object ${expected.key} has different metadata`);
  }
}

function assertCanonicalTarget(key, contentType) {
  assertSafeR2Key(key, "targetKey");
  const image = /^media\/[A-Za-z0-9_-]{21}\/(?:full|view)\.webp$/.test(key) && contentType === "image/webp";
  const audio = /^media\/[A-Za-z0-9_-]{21}\/full\.opus$/.test(key) && contentType === "audio/ogg";
  if (!image && !audio) throw new TypeError("targetKey/contentType is not canonical");
}

function assertInventoryPrefix(prefix) {
  if (prefix === "") return;
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  assertSafeR2Key(normalized, "inventory prefix");
}

async function readLimitedJson(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const declaredSize = integer(declared, "content-length", 0, Number.MAX_SAFE_INTEGER);
    if (declaredSize > MAX_REQUEST_BYTES) throw new MigrationHttpError(413, "Request body is too large");
  }
  if (!request.body) throw new TypeError("Request body is required");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new MigrationHttpError(413, "Request body is too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("Request body must be UTF-8 JSON");
  }
}

async function readExactBytes(request, expectedSize) {
  if (!request.body) throw new TypeError("Request body is required");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize) throw new MigrationHttpError(413, "Request body exceeds declared size");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedSize) throw new MigrationHttpError(409, "[conflict] Request body size differs");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isAuthorized(request, expectedKey) {
  const candidate = request.headers.get("x-infini-migration-token") ?? "";
  let different = candidate.length ^ expectedKey.length;
  for (let index = 0; index < expectedKey.length; index += 1) {
    different |= (candidate.charCodeAt(index) || 0) ^ expectedKey.charCodeAt(index);
  }
  return different === 0;
}

function assertBindings(env) {
  if (!env?.SOURCE?.get || !env?.SOURCE?.list || !env?.TARGET?.head || !env?.TARGET?.put || !env?.TARGET?.list) {
    throw new Error("R2 migration bindings are incomplete");
  }
  if (typeof env.MIGRATION_ACCESS_KEY !== "string" || !R2_SHA256_PATTERN.test(env.MIGRATION_ACCESS_KEY)) {
    throw new Error("R2 migration access key is missing or invalid");
  }
}

function required(url, name) {
  const value = url.searchParams.get(name);
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function requiredHeader(request, name) {
  const value = request.headers.get(name);
  if (!value) throw new TypeError(`${name} header is required`);
  return value;
}

function integer(value, name, minimum, maximum) {
  if (!/^\d+$/.test(value)) throw new TypeError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function sha256Bytes(value) {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function hex(value) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(body, status, headers = {}) {
  const common = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  };
  return body === null
    ? new Response(null, { status, headers: common })
    : Response.json(body, { status, headers: common });
}

class MigrationHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
