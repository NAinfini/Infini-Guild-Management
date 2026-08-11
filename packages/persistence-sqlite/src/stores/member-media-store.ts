import { AppError, type RequestContext } from "@guild/kernel";
import type {
  MemberMediaPort,
  MemberMediaRecord,
} from "@guild/server/modules/members";
import type { MediaService } from "@guild/server/modules/media";
import { LIMITS } from "@guild/shared/config/limits";
import type { AuditMutation } from "@guild/server/modules/audit";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlRow, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments, replaceMediaLinksStatements } from "./media-link-statements.js";
import { returnedRowCount } from "./sql-result.js";

const READ_CHUNK_SIZE = 100;

export type MemberMediaLimits = Readonly<{
  maxProfileImageBytes: number;
  maxProfileAudioBytes: number;
  maxClassIconBytes: number;
  maxProfileImages: number;
}>;

type MemberMediaService = Pick<MediaService, "uploadImages" | "uploadAudio">;
type MutableMemberMedia = {
  avatarMediaId: string | null;
  images: string[];
  audioMediaId: string | null;
  audioName: string | null;
};

/** Production member-media adapter over the shared MediaService and composite media_links lifecycle. */
export class SqliteMemberMediaPort implements MemberMediaPort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly media: MemberMediaService,
    private readonly getLimits: () => Promise<MemberMediaLimits>,
  ) {}

  async listForMembers(userIds: readonly string[]): Promise<ReadonlyMap<string, MemberMediaRecord>> {
    const ids = uniqueBounded(userIds, LIMITS.pagination.users, "Member media read");
    const records = new Map<string, MutableMemberMedia>(ids.map((id) => [id, emptyMedia()]));
    for (const group of chunks(ids, READ_CHUNK_SIZE)) {
      const result = await this.sql.execute({
        method: "all",
        sql: `SELECT links.entity_id, links.slot, links.media_id, assets.original_name
          FROM media_links AS links
          JOIN media_assets AS assets ON assets.id = links.media_id
          WHERE links.entity_type = 'member_profile'
            AND links.entity_id IN (${placeholders(group)})
            AND links.slot IN ('avatar', 'image', 'audio')
          ORDER BY links.entity_id, links.slot, links.sort_order, links.media_id`,
        params: group,
      });
      for (const row of allRows(result)) {
        const memberId = stringValue(row[0]);
        const slot = stringValue(row[1]);
        const mediaId = stringValue(row[2]);
        const record = records.get(memberId);
        if (!record) throw corrupt("Member media query returned an unexpected target");
        if (slot === "image") record.images.push(mediaId);
        else if (slot === "avatar") record.avatarMediaId = mediaId;
        else if (slot === "audio") {
          record.audioMediaId = mediaId;
          record.audioName = nullableString(row[3]);
        } else throw corrupt("Member media query returned an invalid slot");
      }
    }
    return records;
  }

  async uploadProfileImages(
    context: RequestContext,
    userId: string,
    uploads: Parameters<MemberMediaPort["uploadProfileImages"]>[2],
    audit: AuditMutation,
  ): Promise<readonly string[]> {
    const actor = context.authorization.requireAuthenticated();
    const limits = validLimits(await this.getLimits());
    const existing = [...((await this.listForMembers([userId])).get(userId)?.images ?? [])];
    if (existing.length + uploads.length > limits.maxProfileImages) {
      throw validation(`Profiles support at most ${limits.maxProfileImages} images`);
    }
    const uploaded = await this.media.uploadImages(
      context,
      "member_image",
      uploads,
      limits.maxProfileImageBytes,
    );
    const desired = [...existing, ...uploaded];
    await assertMediaAttachments(this.sql, {
      actorUserId: actor.userId,
      entityType: "member_profile",
      entityId: userId,
      slot: "image",
      purpose: "member_image",
      audience: "public",
      mediaIds: desired,
      maxItems: limits.maxProfileImages,
    });
    const business = replaceMediaLinksStatements({
      entityType: "member_profile",
      entityId: userId,
      slot: "image",
      audience: "public",
      mediaIds: desired,
    }, memberGuard(userId));
    const results = await this.sql.batch([
      ...business,
      auditInsertStatement(audit, memberGuard(userId)),
      operationOutcome(audit.id),
    ]);
    if (returnedRowCount(results.at(-1)) !== 1) throw targetChanged();
    return uploaded;
  }

  async deleteProfileImages(
    context: RequestContext,
    userId: string,
    mediaIds: readonly string[],
    audit: AuditMutation,
  ): Promise<number> {
    context.authorization.requireAuthenticated();
    const ids = uniqueBounded(mediaIds, LIMITS.content.profileImagesDeleteBatch.max, "Profile image delete", false);
    const results = await this.sql.batch([
      auditInsertStatement(audit, {
        sql: `SELECT 1 FROM media_links
          WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = 'image'
            AND media_id IN (${placeholders(ids)})`,
        params: [userId, ...ids],
      }),
      {
        method: "all",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = 'image'
            AND media_id IN (${placeholders(ids)})
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING media_id AS media_id`,
        params: [userId, ...ids, audit.id],
        columns: ["media_id"],
      },
    ]);
    return returnedRowCount(results[1]);
  }

  async uploadAvatar(
    context: RequestContext,
    userId: string,
    upload: Parameters<MemberMediaPort["uploadAvatar"]>[2],
    audit: AuditMutation,
  ): Promise<string> {
    const limits = validLimits(await this.getLimits());
    const [mediaId] = await this.media.uploadImages(context, "member_avatar", [upload], limits.maxProfileImageBytes);
    if (!mediaId) throw corrupt("Avatar upload returned no media");
    await this.replaceSingle(context, userId, "avatar", "member_avatar", mediaId, audit);
    return mediaId;
  }

  deleteAvatar(context: RequestContext, userId: string, audit: AuditMutation): Promise<void> {
    return this.deleteMemberSlot(context, userId, "avatar", audit);
  }

  async uploadAudio(
    context: RequestContext,
    userId: string,
    upload: Parameters<MemberMediaPort["uploadAudio"]>[2],
    audit: AuditMutation,
  ): Promise<string> {
    const limits = validLimits(await this.getLimits());
    const mediaId = await this.media.uploadAudio(context, upload, limits.maxProfileAudioBytes);
    await this.replaceSingle(context, userId, "audio", "member_audio", mediaId, audit);
    return mediaId;
  }

  deleteAudio(context: RequestContext, userId: string, audit: AuditMutation): Promise<void> {
    return this.deleteMemberSlot(context, userId, "audio", audit);
  }

  async uploadClassIcon(
    context: RequestContext,
    classId: string,
    upload: Parameters<MemberMediaPort["uploadClassIcon"]>[2],
    audit: AuditMutation,
  ): Promise<string> {
    const actor = context.authorization.requireAuthenticated();
    const limits = validLimits(await this.getLimits());
    const [mediaId] = await this.media.uploadImages(context, "class_icon", [upload], limits.maxClassIconBytes);
    if (!mediaId) throw corrupt("Class icon upload returned no media");
    await assertMediaAttachments(this.sql, {
      actorUserId: actor.userId,
      entityType: "class_catalog",
      entityId: classId,
      slot: "icon",
      purpose: "class_icon",
      audience: "public",
      mediaIds: [mediaId],
      maxItems: 1,
    });
    const operationGuard = auditGuard(audit.id);
    const business = replaceMediaLinksStatements({
      entityType: "class_catalog",
      entityId: classId,
      slot: "icon",
      audience: "public",
      mediaIds: [mediaId],
    }, operationGuard);
    const results = await this.sql.batch([
      auditInsertStatement(audit, classGuard(classId)),
      {
        method: "run",
        sql: `UPDATE class_catalog SET icon_type = 'image', vector_icon = NULL, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
        params: [context.now, classId, audit.id],
      },
      ...business,
      operationOutcome(audit.id),
    ]);
    if (returnedRowCount(results.at(-1)) !== 1) throw targetChanged();
    return mediaId;
  }

  async deleteClassIcon(context: RequestContext, classId: string, audit: AuditMutation): Promise<void> {
    context.authorization.requireAuthenticated();
    const operationGuard = auditGuard(audit.id);
    const results = await this.sql.batch([
      auditInsertStatement(audit, {
        sql: "SELECT 1 FROM class_catalog WHERE id = ? AND icon_type = 'image'",
        params: [classId],
      }),
      {
        method: "run",
        sql: `UPDATE class_catalog SET icon_type = 'vector', vector_icon = 'sword', updated_at = ?
          WHERE id = ? AND icon_type = 'image' AND EXISTS (${operationGuard.sql})`,
        params: [context.now, classId, ...operationGuard.params],
      },
      {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'class_catalog' AND entity_id = ? AND slot = 'icon'
            AND EXISTS (${operationGuard.sql})`,
        params: [classId, ...operationGuard.params],
      },
      operationOutcome(audit.id),
    ]);
    if (returnedRowCount(results.at(-1)) !== 1) throw targetChanged();
  }

  async listClassIcons(classIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const ids = uniqueBounded(classIds, LIMITS.content.classCatalogSize.max, "Class icon read");
    const result = new Map<string, string>();
    for (const group of chunks(ids, READ_CHUNK_SIZE)) {
      const rows = allRows(await this.sql.execute({
        method: "all",
        sql: `SELECT entity_id, media_id FROM media_links
          WHERE entity_type = 'class_catalog' AND slot = 'icon'
            AND entity_id IN (${placeholders(group)})
          ORDER BY entity_id, sort_order, media_id`,
        params: group,
      }));
      for (const row of rows) result.set(stringValue(row[0]), stringValue(row[1]));
    }
    return result;
  }

  private async replaceSingle(
    context: RequestContext,
    userId: string,
    slot: "avatar" | "audio",
    purpose: "member_avatar" | "member_audio",
    mediaId: string,
    audit: AuditMutation,
  ): Promise<void> {
    const actor = context.authorization.requireAuthenticated();
    await assertMediaAttachments(this.sql, {
      actorUserId: actor.userId,
      entityType: "member_profile",
      entityId: userId,
      slot,
      purpose,
      audience: "public",
      mediaIds: [mediaId],
      maxItems: 1,
    });
    const guard = memberGuard(userId);
    const business = replaceMediaLinksStatements({
      entityType: "member_profile",
      entityId: userId,
      slot,
      audience: "public",
      mediaIds: [mediaId],
    }, guard);
    const results = await this.sql.batch([
      ...business,
      auditInsertStatement(audit, guard),
      operationOutcome(audit.id),
    ]);
    if (returnedRowCount(results.at(-1)) !== 1) throw targetChanged();
  }

  private async deleteMemberSlot(
    context: RequestContext,
    userId: string,
    slot: "avatar" | "audio",
    audit: AuditMutation,
  ): Promise<void> {
    context.authorization.requireAuthenticated();
    await this.sql.batch([
      auditInsertStatement(audit, {
        sql: `SELECT 1 FROM media_links
          WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = ?`,
        params: [userId, slot],
      }),
      {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = ?
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
        params: [userId, slot, audit.id],
      },
    ]);
  }
}

function emptyMedia(): MutableMemberMedia {
  return { avatarMediaId: null, images: [], audioMediaId: null, audioName: null };
}

function validLimits(input: MemberMediaLimits): MemberMediaLimits {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 1) throw corrupt(`Invalid member media limit: ${name}`);
  }
  if (input.maxProfileImages > LIMITS.content.profileImages.max) {
    throw corrupt(`Profile image limit exceeds the wire contract maximum of ${LIMITS.content.profileImages.max}`);
  }
  return input;
}

function uniqueBounded(values: readonly string[], maximum: number, label: string, allowEmpty = true): string[] {
  const result = [...new Set(values)];
  if ((!allowEmpty && result.length === 0) || result.length !== values.length || result.length > maximum) {
    throw validation(`${label} must contain ${allowEmpty ? "0" : "1"} to ${maximum} unique IDs`);
  }
  return result;
}

function* chunks<T>(values: readonly T[], size: number): Generator<readonly T[]> {
  for (let index = 0; index < values.length; index += size) yield values.slice(index, index + size);
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function memberGuard(userId: string) {
  return { sql: "SELECT 1 FROM member_profiles WHERE user_id = ?", params: [userId] } as const;
}

function auditGuard(auditId: string) {
  return { sql: "SELECT 1 FROM audit_log WHERE id = ?", params: [auditId] } as const;
}

function classGuard(classId: string) {
  return { sql: "SELECT 1 FROM class_catalog WHERE id = ?", params: [classId] } as const;
}

function operationOutcome(auditId: string): SqlBatchStatement {
  return {
    method: "get",
    columns: ["applied"],
    sql: "SELECT 1 AS applied FROM audit_log WHERE id = ?",
    params: [auditId],
  };
}

function allRows(result: SqlResult): readonly SqlRow[] {
  if (!Array.isArray(result.rows)) throw corrupt("Invalid SQLite rows result");
  if (result.rows.length === 0) return [];
  if (!Array.isArray(result.rows[0])) throw corrupt("Invalid SQLite all result");
  return result.rows as readonly SqlRow[];
}

function stringValue(value: SqlValue | undefined): string {
  if (typeof value !== "string") throw corrupt("Invalid SQLite string value");
  return value;
}

function nullableString(value: SqlValue | undefined): string | null {
  if (value !== null && typeof value !== "string") throw corrupt("Invalid SQLite nullable string value");
  return value;
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function targetChanged(): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message: "Media target changed while the request was processed" });
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
