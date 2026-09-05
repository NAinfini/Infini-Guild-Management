import { AppError, SHA256_HEX_PATTERN } from "@guild/kernel";
import {
  MEDIA_GARBAGE_COLLECTION_BATCH_SIZE,
  type ClaimedMediaDeletion,
  type MediaReadFacts,
  type MediaReservation,
  type MediaStore,
} from "@guild/server/modules/media";
import type { ContentReadScopes } from "@guild/server";
import type { MediaEntityType, MediaVariant } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertSelectStatement } from "./audit-statement.js";
import {
  observedBacklog,
  SCHEDULED_BACKLOG_READ_LIMIT,
} from "./scheduled-backlog.js";

const DELETE_LEASE_MS = 10 * 60 * 1_000;

export class SqliteMediaStore implements MediaStore {
  constructor(private readonly sql: SqlExecutor) {}

  async reserveUploads(inputs: readonly MediaReservation[], requestId: string): Promise<void> {
    if (inputs.length < 1) throw new TypeError("Media reservations must be non-empty");
    if (!requestId.trim()) throw new TypeError("Media reservation request id must be non-empty");
    const reservationsJson = JSON.stringify(inputs);
    const statements: readonly SqlBatchStatement[] = [
      {
        method: "all",
        columns: ["media_id"],
        sql: `WITH incoming_owners AS (
          SELECT
            CAST(json_extract(reservation.value, '$.ownerUserId') AS TEXT) AS owner_user_id,
            count(DISTINCT reservation.key) AS asset_count,
            sum(CAST(json_extract(variant.value, '$.byteSize') AS INTEGER)) AS byte_count
          FROM json_each(?) AS reservation
          CROSS JOIN json_each(reservation.value, '$.variants') AS variant
          GROUP BY CAST(json_extract(reservation.value, '$.ownerUserId') AS TEXT)
        )
        INSERT INTO media_assets (
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
        WHERE NOT EXISTS (
          SELECT 1
          FROM incoming_owners AS incoming
          WHERE incoming.asset_count + (
            SELECT count(*)
            FROM media_assets AS assets
            WHERE assets.owner_user_id = incoming.owner_user_id
              AND assets.state IN ('uploading', 'staged')
          ) > ?
          OR incoming.byte_count + (
            SELECT coalesce(sum(variants.byte_size), 0)
            FROM media_assets AS assets
            JOIN media_variants AS variants ON variants.media_id = assets.id
            WHERE assets.owner_user_id = incoming.owner_user_id
              AND assets.state IN ('uploading', 'staged')
          ) > ?
        )
        ORDER BY CAST(reservation.key AS INTEGER)
        RETURNING id AS media_id`,
        params: [
          reservationsJson,
          reservationsJson,
          LIMITS.media.pendingPerOwner.maxAssets,
          LIMITS.media.pendingPerOwner.maxBytes,
        ],
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
        JOIN media_assets AS assets
          ON assets.id = json_extract(reservation.value, '$.id')
          AND assets.owner_user_id = json_extract(reservation.value, '$.ownerUserId')
          AND assets.state = 'uploading'
        ORDER BY CAST(reservation.key AS INTEGER), CAST(variant.key AS INTEGER)`,
        params: [reservationsJson],
      },
      {
        method: "run",
        sql: `INSERT OR IGNORE INTO system_test_artifacts
          (run_id, artifact_type, artifact_key, request_id, created_at)
        SELECT requests.run_id,
          'media_asset',
          json_extract(reservation.value, '$.id'),
          requests.request_id,
          json_extract(reservation.value, '$.createdAt')
        FROM system_test_requests AS requests
        JOIN system_test_runs AS runs ON runs.id = requests.run_id
        CROSS JOIN json_each(?) AS reservation
        JOIN media_assets AS assets
          ON assets.id = json_extract(reservation.value, '$.id')
          AND assets.owner_user_id = json_extract(reservation.value, '$.ownerUserId')
          AND assets.state = 'uploading'
        WHERE requests.request_id = ?
          AND runs.status = 'running'
        ORDER BY CAST(reservation.key AS INTEGER)`,
        params: [reservationsJson, requestId],
      },
    ];
    const results = await this.sql.batch(statements);
    if (allRows(results[0]!).length !== inputs.length) {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Pending media budget exceeded",
        details: {
          max_pending_assets: LIMITS.media.pendingPerOwner.maxAssets,
          max_pending_bytes: LIMITS.media.pendingPerOwner.maxBytes,
        },
      });
    }
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

  async describeRead(
    mediaId: string,
    variant: MediaVariant,
    now: string,
    scopes: ContentReadScopes,
  ): Promise<MediaReadFacts | null> {
    const publicRead = publicReadCondition(now);
    const contentRead = contentReadCondition(scopes);
    const result = await this.sql.read({
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
            WHEN MAX(CASE WHEN (${publicRead.sql}) THEN 1 ELSE 0 END) = 1 THEN 'public'
            WHEN MAX(CASE WHEN links.audience = 'authenticated' THEN 1 ELSE 0 END) = 1 THEN 'authenticated'
            ELSE 'private'
          END,
          CASE WHEN MAX(CASE WHEN (${contentRead.sql}) THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END
        FROM media_assets AS assets
        JOIN media_variants AS variants ON variants.media_id = assets.id
        LEFT JOIN (
          SELECT media_id, entity_type, entity_id, audience
          FROM media_links
          WHERE media_id = ?
          UNION ALL
          SELECT revision_media.media_id, 'wiki_article' AS entity_type, revisions.article_id AS entity_id,
            revision_media.audience
          FROM wiki_revision_media AS revision_media
          JOIN wiki_revisions AS revisions ON revisions.id = revision_media.revision_id
          WHERE revision_media.media_id = ?
        ) AS links ON links.media_id = assets.id
        WHERE assets.id = ?
          AND variants.variant = ?
          AND (
            assets.state = 'attached'
            OR (assets.state = 'staged' AND assets.expires_at > ?)
          )
        GROUP BY variants.object_key, variants.byte_size, variants.content_type, variants.sha256,
          assets.owner_user_id, assets.media_type, assets.original_name`,
      params: [...publicRead.params, ...contentRead.params, mediaId, mediaId, mediaId, variant, now],
    });
    const row = oneRow(result);
    if (!row) return null;
    const [
      objectKey,
      byteSize,
      contentType,
      sha256,
      ownerUserId,
      mediaType,
      originalName,
      rawEntityTypes,
      audience,
      contentReadable,
    ] = row;
    if (
      typeof objectKey !== "string"
      || typeof byteSize !== "number"
      || !Number.isSafeInteger(byteSize)
      || byteSize < 0
      || (
        contentType !== "image/webp"
        && contentType !== "audio/ogg"
        && contentType !== "application/octet-stream"
        && contentType !== "application/pdf"
        && contentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
      || typeof sha256 !== "string"
      || !SHA256_HEX_PATTERN.test(sha256)
      || (ownerUserId !== null && typeof ownerUserId !== "string")
      || (mediaType !== "image" && mediaType !== "audio" && mediaType !== "file")
      || (originalName !== null && typeof originalName !== "string")
      || (contentReadable !== 0 && contentReadable !== 1)
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
      contentReadable: contentReadable === 1,
      audience,
    };
  }

  async claimGarbage(before: string, limit: number): Promise<readonly ClaimedMediaDeletion[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Media GC limit must be between 1 and 50");
    const candidates = await this.selectGarbageCandidates(before, limit);
    if (candidates.length === 0) return [];
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
          WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            AND ((state IN ('uploading', 'staged') AND expires_at <= ?)
              OR (state = 'deleting' AND (delete_claim_until IS NULL OR delete_claim_until <= ?)))`,
        params: [
          claimToken,
          claimUntil,
          before,
          JSON.stringify(candidates.map((candidate) => candidate.id)),
          before,
          before,
        ],
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
    const pendingAt = (await this.selectGarbageCandidates(before, SCHEDULED_BACKLOG_READ_LIMIT))
      .map((candidate) => candidate.pendingAt);
    return observedBacklog(pendingAt);
  }

  private async selectGarbageCandidates(before: string, limit: number): Promise<readonly Readonly<{
    id: string;
    pendingAt: string;
  }>[]> {
    const results = await this.sql.readBatch([
      {
        method: "all",
        columns: ["id", "pending_at"],
        sql: `SELECT id, expires_at AS pending_at
          FROM media_assets INDEXED BY idx_media_assets_gc
          WHERE state = 'uploading' AND expires_at <= ?
          ORDER BY expires_at, delete_claim_until, id
          LIMIT ?`,
        params: [before, limit],
      },
      {
        method: "all",
        columns: ["id", "pending_at"],
        sql: `SELECT id, expires_at AS pending_at
          FROM media_assets INDEXED BY idx_media_assets_gc
          WHERE state = 'staged' AND expires_at <= ?
          ORDER BY expires_at, delete_claim_until, id
          LIMIT ?`,
        params: [before, limit],
      },
      {
        method: "all",
        columns: ["id", "pending_at"],
        sql: `SELECT id, delete_claim_until AS pending_at
          FROM media_assets INDEXED BY idx_media_assets_gc_deleting
          WHERE state = 'deleting' AND delete_claim_until IS NOT NULL AND delete_claim_until <= ?
          ORDER BY delete_claim_until, updated_at, id
          LIMIT ?`,
        params: [before, limit],
      },
      {
        method: "all",
        columns: ["id", "pending_at"],
        sql: `SELECT id, updated_at AS pending_at
          FROM media_assets INDEXED BY idx_media_assets_gc_deleting
          WHERE state = 'deleting' AND delete_claim_until IS NULL
          ORDER BY updated_at, id
          LIMIT ?`,
        params: [limit],
      },
    ]);
    return results
      .flatMap((result) => allRows(result))
      .map((row) => {
        const [id, pendingAt] = row;
        if (typeof id !== "string" || typeof pendingAt !== "string") {
          throw corrupt("Invalid media garbage backlog projection");
        }
        return { id, pendingAt };
      })
      .sort((left, right) => left.pendingAt.localeCompare(right.pendingAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async finalizeDeletions(deletions: Parameters<MediaStore["finalizeDeletions"]>[0]): Promise<readonly string[]> {
    if (deletions.length < 1 || deletions.length > MEDIA_GARBAGE_COLLECTION_BATCH_SIZE) {
      throw new RangeError(`Media deletion batches must contain 1 to ${MEDIA_GARBAGE_COLLECTION_BATCH_SIZE} claims`);
    }
    if (new Set(deletions.map(({ mediaId }) => mediaId)).size !== deletions.length) {
      throw new TypeError("Media deletion claims must be unique");
    }
    const payload = JSON.stringify(deletions);
    const results = await this.sql.batch([
      auditInsertSelectStatement(`SELECT
          json_extract(entry.value, '$.audit.eventId'),
          json_extract(entry.value, '$.audit.requestId'),
          json_extract(entry.value, '$.audit.actorKind'),
          json_extract(entry.value, '$.audit.actorId'),
          CASE WHEN json_extract(entry.value, '$.audit.actorKind') = 'user'
            THEN (SELECT display_name FROM users WHERE id = json_extract(entry.value, '$.audit.actorId'))
            ELSE json_extract(entry.value, '$.audit.actorLabel') END,
          json_extract(entry.value, '$.audit.subjectType'),
          json_extract(entry.value, '$.audit.subjectId'),
          json_extract(entry.value, '$.audit.subjectLabel'),
          json_extract(entry.value, '$.audit.action'),
          json_extract(entry.value, '$.audit.payload'),
          json_extract(entry.value, '$.audit.occurredAt')
        FROM json_each(?) AS entry
        JOIN media_assets AS assets ON assets.id = json_extract(entry.value, '$.mediaId')
          AND assets.delete_claim_token = json_extract(entry.value, '$.claimToken')
        WHERE assets.state = 'deleting'`, [payload]),
      {
        method: "all",
        sql: `DELETE FROM media_assets
          WHERE state = 'deleting' AND (id, delete_claim_token) IN (
            SELECT json_extract(entry.value, '$.mediaId'), json_extract(entry.value, '$.claimToken')
            FROM json_each(?) AS entry
            JOIN audit_log ON audit_log.id = json_extract(entry.value, '$.audit.eventId')
          )
          RETURNING id AS deleted_id`,
        params: [payload],
        columns: ["deleted_id"],
      },
    ]);
    return allRows(results[1]).map(([id]) => {
      if (typeof id !== "string") throw corrupt("Invalid media deletion result");
      return id;
    });
  }
}

function publicReadCondition(now: string): Readonly<{ sql: string; params: SqlValue[] }> {
  return {
    sql: `links.audience = 'public' AND (
      links.entity_type NOT IN ('announcement', 'wiki_article', 'event', 'member_profile')
      OR (links.entity_type = 'announcement' AND EXISTS (
        SELECT 1 FROM announcements AS public_announcement
        WHERE public_announcement.id = links.entity_id
          AND public_announcement.status = 'published'
          AND public_announcement.publish_at <= ?
          AND (public_announcement.expires_at IS NULL OR public_announcement.expires_at > ?)
      ))
      OR (links.entity_type = 'wiki_article' AND EXISTS (
        SELECT 1 FROM wiki_articles AS public_article
        WHERE public_article.id = links.entity_id
          AND public_article.archived_at IS NULL
          AND public_article.deleted_at IS NULL
      ))
      OR (links.entity_type = 'event' AND EXISTS (
        SELECT 1 FROM events AS public_event
        WHERE public_event.id = links.entity_id
          AND public_event.archived_at IS NULL
          AND (public_event.visible_at IS NULL OR public_event.visible_at <= ?)
      ))
      OR (links.entity_type = 'member_profile' AND EXISTS (
        SELECT 1 FROM users AS public_member
        WHERE public_member.id = links.entity_id
          AND public_member.is_active = 1
          AND public_member.deleted_at IS NULL
      ))
    )`,
    params: [now, now, now],
  };
}

function contentReadCondition(scopes: ContentReadScopes): Readonly<{ sql: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (scopes.announcement.kind === "all") {
    clauses.push("links.entity_type = 'announcement'");
  } else if (scopes.announcement.kind === "owned") {
    clauses.push(`(links.entity_type = 'announcement' AND EXISTS (
      SELECT 1 FROM announcements AS parent_announcement
      WHERE parent_announcement.id = links.entity_id AND parent_announcement.created_by = ?
    ))`);
    params.push(scopes.announcement.ownerUserId);
  }
  if (scopes.wikiArticle.kind === "all") {
    clauses.push("links.entity_type = 'wiki_article'");
  } else if (scopes.wikiArticle.kind === "owned") {
    clauses.push(`(links.entity_type = 'wiki_article' AND EXISTS (
      SELECT 1 FROM wiki_articles AS parent_article
      WHERE parent_article.id = links.entity_id AND parent_article.created_by = ?
        AND parent_article.deleted_at IS NULL
    ))`);
    params.push(scopes.wikiArticle.ownerUserId);
  }
  return { sql: clauses.length > 0 ? clauses.join(" OR ") : "0", params };
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
