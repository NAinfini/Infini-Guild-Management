import { AppError } from "@guild/kernel";
import type { MediaEntityType, MediaPurpose, MediaSlot } from "@guild/shared";
import type { SqlBatchStatement, SqlExecutor, SqlValue } from "@guild/kernel";

export type MediaAttachmentTarget = Readonly<{
  actorUserId: string;
  entityType: MediaEntityType;
  entityId: string;
  slot: MediaSlot;
  purpose: MediaPurpose;
  audience: "public" | "authenticated" | "private";
  mediaIds: readonly string[];
  maxItems: number;
}>;

export async function assertOwnedStagedMedia(
  sql: SqlExecutor,
  input: Readonly<{
    ownerUserId: string;
    purpose: MediaPurpose;
    mediaIds: readonly string[];
    maxItems: number;
  }>,
): Promise<void> {
  const mediaIds = [...new Set(input.mediaIds)];
  if (mediaIds.length < 1 || mediaIds.length !== input.mediaIds.length || mediaIds.length > input.maxItems) {
    throw validation(`Media batch must contain 1 to ${input.maxItems} unique assets`);
  }
  const result = await sql.execute({
    method: "get",
    sql: `SELECT COUNT(*)
      FROM media_assets AS assets
      LEFT JOIN media_links AS links ON links.media_id = assets.id
      WHERE assets.id IN (SELECT value FROM json_each(?))
        AND assets.owner_user_id = ?
        AND assets.purpose = ?
        AND assets.state = 'staged'
        AND links.media_id IS NULL`,
    params: [JSON.stringify(mediaIds), input.ownerUserId, input.purpose],
  });
  const row = result.rows;
  const count = Array.isArray(row) && !Array.isArray(row[0]) ? row[0] : undefined;
  if (count !== mediaIds.length) {
    throw new AppError({ code: "FORBIDDEN", status: 403, message: "Media batch contains an unowned or unavailable asset" });
  }
}

/**
 * Ownership and purpose are immutable, so this read is safe before the domain's atomic write.
 * Link state is rechecked by media_links triggers inside that write.
 */
export async function assertMediaAttachments(
  sql: SqlExecutor,
  target: MediaAttachmentTarget,
): Promise<readonly string[]> {
  const mediaIds = [...new Set(target.mediaIds)];
  if (mediaIds.length !== target.mediaIds.length || mediaIds.length > target.maxItems || target.maxItems < 0) {
    throw validation(`Media attachment count must not exceed ${target.maxItems} and cannot contain duplicates`);
  }
  if (mediaIds.length === 0) return mediaIds;

  const result = await sql.execute({
    method: "all",
    sql: `SELECT
        assets.id,
        assets.owner_user_id,
        assets.purpose,
        assets.state,
        MAX(CASE WHEN links.entity_type = ? AND links.entity_id = ? AND links.slot = ? THEN 1 ELSE 0 END)
      FROM media_assets AS assets
      LEFT JOIN media_links AS links ON links.media_id = assets.id
      WHERE assets.id IN (SELECT value FROM json_each(?))
      GROUP BY assets.id, assets.owner_user_id, assets.purpose, assets.state
      ORDER BY assets.id`,
    params: [target.entityType, target.entityId, target.slot, JSON.stringify(mediaIds)],
  });
  const rows = result.rows;
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row)) || rows.length !== mediaIds.length) {
    throw validation("One or more media attachments do not exist");
  }

  for (const rawRow of rows as readonly (readonly SqlValue[])[]) {
    const [mediaId, ownerUserId, purpose, state, targetLinkCount] = rawRow;
    const alreadyOnTarget = typeof targetLinkCount === "number" && targetLinkCount > 0;
    const ownedAttachableAsset = ownerUserId === target.actorUserId
      && (state === "staged" || state === "attached");
    if (typeof mediaId !== "string" || purpose !== target.purpose || (!alreadyOnTarget && !ownedAttachableAsset)) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Media attachment is not owned or attachable" });
    }
  }
  return mediaIds;
}

export function replaceMediaLinksStatements(
  target: Omit<MediaAttachmentTarget, "actorUserId" | "purpose" | "maxItems">,
  guard?: Readonly<{ sql: string; params: readonly SqlValue[] }>,
): readonly SqlBatchStatement[] {
  const mediaIds = [...target.mediaIds];
  const mediaIdsJson = JSON.stringify(mediaIds);
  const guarded = guard ? `AND EXISTS (${guard.sql})` : "";
  const shift: SqlBatchStatement = {
    method: "run",
    sql: `UPDATE media_links SET sort_order = sort_order + 1000000
      WHERE entity_type = ? AND entity_id = ? AND slot = ? ${guarded}`,
    params: [target.entityType, target.entityId, target.slot, ...(guard?.params ?? [])],
  };
  const remove: SqlBatchStatement = {
    method: "run",
    sql: `DELETE FROM media_links
      WHERE entity_type = ? AND entity_id = ? AND slot = ?
        AND media_id NOT IN (SELECT value FROM json_each(?)) ${guarded}`,
    params: [target.entityType, target.entityId, target.slot, mediaIdsJson, ...(guard?.params ?? [])],
  };
  const attach: SqlBatchStatement = {
    method: "run",
    sql: `INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
      SELECT media.value, ?, ?, ?, ?, CAST(media.key AS INTEGER)
      FROM json_each(?) AS media
      WHERE ${guard ? `EXISTS (${guard.sql})` : "1"}
      ON CONFLICT(entity_type, entity_id, slot, media_id) DO UPDATE SET
        audience = excluded.audience,
        sort_order = excluded.sort_order`,
    params: [
      target.entityType,
      target.entityId,
      target.slot,
      target.audience,
      mediaIdsJson,
      ...(guard?.params ?? []),
    ],
  };
  return [shift, remove, attach];
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
