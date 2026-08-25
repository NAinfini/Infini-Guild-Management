import { AppError, SHA256_HEX_PATTERN } from "@guild/kernel";
import type {
  ClaimedMediaDeletion,
  MediaReadFacts,
  MediaReservation,
  MediaStore,
} from "@guild/server/modules/media";
import type { AuditEventWrite } from "@guild/server/modules/audit";
import type { MediaEntityType, MediaVariant } from "@guild/shared";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import {
  observedBacklog,
  SCHEDULED_BACKLOG_READ_LIMIT,
} from "./scheduled-backlog.js";

const DELETE_LEASE_MS = 10 * 60 * 1_000;

export class SqliteMediaStore implements MediaStore {
  constructor(private readonly sql: SqlExecutor) {}

  async reserveUploads(inputs: readonly MediaReservation[]): Promise<void> {
    if (inputs.length < 1) throw new TypeError("Media reservations must be non-empty");
    const reservationsJson = JSON.stringify(inputs);
    const statements: readonly SqlBatchStatement[] = [
      {
        method: "run",
        sql: `INSERT INTO media_assets (
          id, owner_user_id, purpose, media_type, state, original_name, expires_at, created_at, updated_at
        ) SELECT
          json_extract(reservation.value, '$.id'),
          json_extract(reservation.value, '$.ownerUserId'),
          json_extract(reservation.value, '$.purpose'),
          json_extract(reservation.value, '$.mediaType'),
          'uploading',
          json_extract(reservation.value, '$.originalName'),
          json_extract(reservation.value, '$.expiresAt'),
          json_extract(reservation.value, '$.createdAt'),
          json_extract(reservation.value, '$.createdAt')
        FROM json_each(?) AS reservation
        ORDER BY CAST(reservation.key AS INTEGER)`,
        params: [reservationsJson],
      },
      {
        method: "run",
        sql: `INSERT INTO media_variants (
          media_id, variant, object_key, content_type, byte_size, sha256, width, height
        ) SELECT
          json_extract(reservation.value, '$.id'),
          json_extract(variant.value, '$.variant'),
          json_extract(variant.value, '$.objectKey'),
          json_extract(variant.value, '$.contentType'),
          json_extract(variant.value, '$.byteSize'),
          json_extract(variant.value, '$.sha256'),
          json_extract(variant.value, '$.width'),
          json_extract(variant.value, '$.height')
        FROM json_each(?) AS reservation
        CROSS JOIN json_each(reservation.value, '$.variants') AS variant
        ORDER BY CAST(reservation.key AS INTEGER), CAST(variant.key AS INTEGER)`,
        params: [reservationsJson],
      },
    ];
    await this.sql.batch(statements);
  }

  async markStaged(mediaIds: readonly string[], stagedAt: string): Promise<void> {
    assertMediaIds(mediaIds);
    const result = await this.sql.execute({
      method: "all",
      sql: `UPDATE media_assets
        SET state = 'staged', updated_at = ?
        WHERE id IN (${placeholders(mediaIds.length)}) AND state = 'uploading'
        RETURNING id AS media_id`,
      params: [stagedAt, ...mediaIds],
      columns: ["media_id"],
    });
    const stagedIds = allRows(result).map((row) => row[0]);
    if (
      stagedIds.some((id) => typeof id !== "string")
      || new Set(stagedIds).size !== mediaIds.length
      || mediaIds.some((id) => !stagedIds.includes(id))
    ) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Media upload reservation was lost" });
    }
  }

  async markDeleting(mediaIds: readonly string[], at: string): Promise<void> {
    assertMediaIds(mediaIds);
    await this.sql.execute({
      method: "run",
      sql: `UPDATE media_assets
        SET state = 'deleting', delete_claim_token = NULL, delete_claim_until = NULL, updated_at = ?
        WHERE id IN (${placeholders(mediaIds.length)}) AND state IN ('uploading', 'staged')`,
      params: [at, ...mediaIds],
    });
  }

  async describeRead(mediaId: string, variant: MediaVariant, now: string): Promise<MediaReadFacts | null> {
    const result = await this.sql.execute({
      method: "get",
      sql: `SELECT
          variants.object_key,
          variants.byte_size,
          variants.content_type,
          variants.sha256,
          assets.owner_user_id,
          assets.media_type,
          assets.original_name,
          COALESCE(group_concat(DISTINCT links.entity_type), ''),
          CASE
            WHEN MAX(CASE WHEN links.audience = 'public' THEN 1 ELSE 0 END) = 1 THEN 'public'
            WHEN MAX(CASE WHEN links.audience = 'authenticated' THEN 1 ELSE 0 END) = 1 THEN 'authenticated'
            ELSE 'private'
          END
        FROM media_assets AS assets
        JOIN media_variants AS variants ON variants.media_id = assets.id
        LEFT JOIN (
          SELECT media_id, entity_type, audience
          FROM media_links
          WHERE media_id = ?
          UNION ALL
          SELECT media_id, 'wiki_article' AS entity_type, audience
          FROM wiki_revision_media
          WHERE media_id = ?
        ) AS links ON links.media_id = assets.id
        WHERE assets.id = ?
          AND variants.variant = ?
          AND (
            assets.state = 'attached'
            OR (assets.state = 'staged' AND assets.expires_at > ?)
          )
        GROUP BY variants.object_key, variants.byte_size, variants.content_type, variants.sha256,
          assets.owner_user_id, assets.media_type, assets.original_name`,
      params: [mediaId, mediaId, mediaId, variant, now],
    });
    const row = oneRow(result);
    if (!row) return null;
    const [objectKey, byteSize, contentType, sha256, ownerUserId, mediaType, originalName, rawEntityTypes, audience] = row;
    if (
      typeof objectKey !== "string"
      || typeof byteSize !== "number"
      || !Number.isSafeInteger(byteSize)
      || byteSize < 0
      || (
        contentType !== "image/webp"
        && contentType !== "audio/ogg"
        && contentType !== "application/pdf"
        && contentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
      || typeof sha256 !== "string"
      || !SHA256_HEX_PATTERN.test(sha256)
      || (ownerUserId !== null && typeof ownerUserId !== "string")
      || (mediaType !== "image" && mediaType !== "audio" && mediaType !== "file")
      || (originalName !== null && typeof originalName !== "string")
    ) {
      throw corrupt("Invalid media read projection");
    }
    if (typeof rawEntityTypes !== "string") throw corrupt("Invalid media entity types");
    if (audience !== "public" && audience !== "authenticated" && audience !== "private") {
      throw corrupt("Invalid media audience");
    }
    return {
      objectKey,
      byteSize,
      contentType,
      sha256,
      ownerUserId,
      mediaType,
      originalName,
      entityTypes: rawEntityTypes ? rawEntityTypes.split(",") as MediaEntityType[] : [],
      audience,
    };
  }

  async claimGarbage(before: string, limit: number): Promise<readonly ClaimedMediaDeletion[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Media GC limit must be between 1 and 50");
    const claimToken = crypto.randomUUID();
    const claimUntil = new Date(Date.parse(before) + DELETE_LEASE_MS).toISOString();
    const results = await this.sql.batch([
      {
        method: "run",
        sql: `UPDATE media_assets
          SET state = 'deleting',
              delete_claim_token = ?,
              delete_claim_until = ?,
              updated_at = ?
          WHERE id IN (
            SELECT id
            FROM media_assets
            WHERE (state IN ('uploading', 'staged') AND expires_at <= ?)
               OR (state = 'deleting' AND (delete_claim_until IS NULL OR delete_claim_until <= ?))
            ORDER BY COALESCE(expires_at, updated_at), id
            LIMIT ?
          )`,
        params: [claimToken, claimUntil, before, before, before, limit],
      },
      {
        method: "all",
        sql: `SELECT assets.id AS media_id,
            assets.delete_claim_token AS claim_token,
            variants.object_key AS object_key
          FROM media_assets AS assets
          JOIN media_variants AS variants ON variants.media_id = assets.id
          WHERE assets.delete_claim_token = ?
          ORDER BY assets.id, variants.variant`,
        params: [claimToken],
        columns: ["media_id", "claim_token", "object_key"],
      },
    ]);

    const rows = allRows(results[1]);
    const claims = new Map<string, { claimToken: string; objectKeys: string[] }>();
    for (const row of rows) {
      const [mediaId, token, objectKey] = row;
      if (typeof mediaId !== "string" || typeof token !== "string" || typeof objectKey !== "string") {
        throw corrupt("Invalid media deletion projection");
      }
      const claim = claims.get(mediaId) ?? { claimToken: token, objectKeys: [] };
      claim.objectKeys.push(objectKey);
      claims.set(mediaId, claim);
    }
    return [...claims].map(([mediaId, claim]) => ({ mediaId, ...claim }));
  }

  async inspectGarbageBacklog(before: string) {
    const pendingAt = allRows(await this.sql.execute({
      method: "all",
      columns: ["pending_at"],
      sql: `SELECT COALESCE(expires_at, updated_at) AS pending_at
        FROM media_assets
        WHERE (state IN ('uploading', 'staged') AND expires_at <= ?)
           OR (state = 'deleting' AND (delete_claim_until IS NULL OR delete_claim_until <= ?))
        ORDER BY COALESCE(expires_at, updated_at), id
        LIMIT ?`,
      params: [before, before, SCHEDULED_BACKLOG_READ_LIMIT],
    })).map((row) => {
      const pendingAt = row[0];
      if (typeof pendingAt !== "string") throw corrupt("Invalid media garbage backlog projection");
      return pendingAt;
    });
    return observedBacklog(pendingAt);
  }

  async finalizeDeletion(mediaId: string, claimToken: string, audit: AuditEventWrite): Promise<void> {
    const results = await this.sql.batch([
      auditInsertStatement(audit, {
        sql: `SELECT 1 FROM media_assets
          WHERE id = ? AND state = 'deleting' AND delete_claim_token = ?`,
        params: [mediaId, claimToken],
      }),
      {
        method: "get",
        sql: `DELETE FROM media_assets
          WHERE id = ? AND state = 'deleting' AND delete_claim_token = ?
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING id AS deleted_id`,
        params: [mediaId, claimToken, audit.eventId],
        columns: ["deleted_id"],
      },
    ]);
    const deleted = oneRow(results[1]);
    if (!deleted || deleted[0] !== mediaId) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Media deletion claim expired" });
    }
  }
}

function assertMediaIds(mediaIds: readonly string[]): void {
  if (mediaIds.length < 1 || new Set(mediaIds).size !== mediaIds.length) {
    throw new TypeError("Media ids must be non-empty and unique");
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function oneRow(result: SqlResult | undefined): readonly SqlValue[] | null {
  if (!result || result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw corrupt("SQLite get returned an invalid row");
  }
  return result.rows as readonly SqlValue[];
}

function allRows(result: SqlResult | undefined): readonly (readonly SqlValue[])[] {
  if (!result || result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw corrupt("SQLite all returned invalid rows");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
