import {
  AppError,
  SHA256_HEX_PATTERN,
  assertBlobKey,
  type SqlExecutor,
  type SqlResult,
  type SqlValue,
} from "@guild/kernel";
import { AUDIT_ARCHIVE_CONTENT_TYPE } from "@guild/server/modules/audit";
import type {
  BlobManifestDescriptor,
  BlobManifestStore,
} from "@guild/server/modules/blob-reconciliation";

const COLUMNS = ["source", "source_id", "object_key", "byte_size", "content_type", "sha256"] as const;
const MEDIA_MANIFEST_SELECT = `SELECT 'media' AS source,
    variants.media_id || ':' || variants.variant AS source_id,
    variants.object_key AS object_key,
    variants.byte_size AS byte_size,
    variants.content_type AS content_type,
    variants.sha256 AS sha256
  FROM media_variants AS variants INDEXED BY ux_media_variants_object_key
  JOIN media_assets AS assets ON assets.id = variants.media_id
  WHERE assets.state IN ('staged', 'attached')`;
const AUDIT_MANIFEST_SELECT = `SELECT 'audit' AS source,
    archives.id AS source_id,
    archives.object_key AS object_key,
    archives.size_bytes AS byte_size,
    ? AS content_type,
    archives.sha256 AS sha256
  FROM audit_archives AS archives INDEXED BY ux_audit_archives_object_key
  WHERE archives.status = 'ready'`;

type ManifestPhase = BlobManifestDescriptor["source"];
type ManifestCursor = Readonly<{ phase: ManifestPhase; objectKey?: string }>;

export class SqliteBlobManifestStore implements BlobManifestStore {
  constructor(private readonly sql: SqlExecutor) {}

  async listPage(request: Readonly<{ checkpoint?: string; limit: number }>) {
    const cursor = pageCursor(request);
    let rows = await this.listPhase(cursor.phase, cursor.objectKey, request.limit + 1);
    if (cursor.phase === "audit" && rows.length <= request.limit) {
      rows = [
        ...rows,
        ...await this.listPhase("media", undefined, request.limit + 1 - rows.length),
      ];
    }
    const hasMore = rows.length > request.limit;
    const descriptors = hasMore ? rows.slice(0, request.limit) : rows;
    return {
      descriptors,
      nextCheckpoint: hasMore ? descriptors.at(-1)!.objectKey : null,
    };
  }

  private async listPhase(
    phase: ManifestPhase,
    checkpoint: string | undefined,
    limit: number,
  ): Promise<readonly BlobManifestDescriptor[]> {
    const select = phase === "audit" ? AUDIT_MANIFEST_SELECT : MEDIA_MANIFEST_SELECT;
    const objectKey = phase === "audit" ? "archives.object_key" : "variants.object_key";
    return allRows(await this.sql.read({
      method: "all",
      columns: COLUMNS,
      sql: `${select}
        ${checkpoint ? `AND ${objectKey} > ?` : ""}
        ORDER BY ${objectKey} LIMIT ?`,
      params: [
        ...(phase === "audit" ? [AUDIT_ARCHIVE_CONTENT_TYPE] : []),
        ...(checkpoint ? [checkpoint] : []),
        limit,
      ],
    })).map(mapDescriptor);
  }

  async findByObjectKeys(objectKeys: readonly string[]): Promise<readonly BlobManifestDescriptor[]> {
    if (objectKeys.length === 0) return [];
    if (objectKeys.length > 50 || new Set(objectKeys).size !== objectKeys.length) {
      throw new RangeError("Blob manifest lookup supports between 1 and 50 unique keys");
    }
    objectKeys.forEach(assertBlobKey);
    return allRows(await this.sql.read({
      method: "all",
      columns: COLUMNS,
      sql: `WITH requested(object_key) AS (SELECT value FROM json_each(?))
        ${manifestSelect()}
        WHERE object_key IN (SELECT object_key FROM requested)
        ORDER BY object_key`,
      params: [JSON.stringify(objectKeys), AUDIT_ARCHIVE_CONTENT_TYPE],
    })).map(mapDescriptor);
  }
}

function manifestSelect(): string {
  return `SELECT source, source_id, object_key, byte_size, content_type, sha256 FROM (
    ${MEDIA_MANIFEST_SELECT}
    UNION ALL
    ${AUDIT_MANIFEST_SELECT}
  ) AS manifests`;
}

function pageCursor(request: Readonly<{ checkpoint?: string; limit: number }>): ManifestCursor {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50) {
    throw new RangeError("Blob manifest page limit must be between 1 and 50");
  }
  if (!request.checkpoint) return { phase: "audit" };
  assertBlobKey(request.checkpoint);
  if (request.checkpoint.startsWith("audit/")) return { phase: "audit", objectKey: request.checkpoint };
  if (request.checkpoint.startsWith("media/")) return { phase: "media", objectKey: request.checkpoint };
  throw new TypeError("Blob manifest checkpoint must use an audit/ or media/ object key");
}

function mapDescriptor(row: readonly SqlValue[]): BlobManifestDescriptor {
  const [source, sourceId, objectKey, byteSize, contentType, sha256] = row;
  if (
    (source !== "media" && source !== "audit")
    || typeof sourceId !== "string"
    || !sourceId
    || typeof objectKey !== "string"
    || !objectKey.startsWith(`${source}/`)
    || typeof byteSize !== "number"
    || !Number.isSafeInteger(byteSize)
    || byteSize < 1
    || typeof contentType !== "string"
    || !contentType
    || typeof sha256 !== "string"
    || !SHA256_HEX_PATTERN.test(sha256)
  ) {
    throw corrupt("Invalid blob manifest descriptor");
  }
  assertBlobKey(objectKey);
  return { source, sourceId, objectKey, byteSize, contentType, sha256 };
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw corrupt("Invalid blob manifest row set");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
