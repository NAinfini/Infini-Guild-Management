import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent, type AuditEventWrite } from "@guild/server/modules/audit";
import type { MediaService } from "@guild/server/modules/media";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAbsencePolicyReader } from "./absence-policy-reader.js";
import { SqliteMemberMediaPort } from "./member-media-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const CLASS_ICON_UPDATED_AT = "2026-08-09T12:00:01.000Z";
const OLD_AVATAR = "aaaaaaaaaaaaaaaaaaaaa";
const NEW_AVATAR = "bbbbbbbbbbbbbbbbbbbbb";
const NEW_IMAGE = "ccccccccccccccccccccc";
const MISSING_IMAGE = "ggggggggggggggggggggg";
const CLASS_ICON = "ddddddddddddddddddddd";
const OLD_AUDIO = "eeeeeeeeeeeeeeeeeeeee";
const NEW_AUDIO = "fffffffffffffffffffff";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  database.exec(`
    INSERT INTO users (id, display_name, role_id, revision_token) VALUES
      ('admin-1', 'AdminOne', 'admin', 'admin-one-revision-0001'),
      ('member-1', 'MemberOne', 'member', 'member-one-revision-0001'),
      ('member-2', 'MemberTwo', 'member', 'member-two-revision-0001');
    INSERT INTO member_profiles (user_id, revision_token) VALUES
      ('member-1', 'profile-one-revision-0001'),
      ('member-2', 'profile-two-revision-0001');
    INSERT INTO class_catalog (id, label, color, icon_type, vector_icon, updated_at)
      VALUES ('class-1', 'Class One', '#ffffff', 'vector', 'sword', '${NOW}');
  `);
  const executor = new SqliteTestExecutor(database);
  const nextImages: string[] = [];
  const nextAudio: string[] = [];
  const media = {
    uploadImages: vi.fn(async (_context, purpose: "member_avatar" | "member_image" | "class_icon", uploads) => {
      return uploads.map(() => {
        const id = nextImages.shift();
        if (!id) throw new Error("Missing test image ID");
        insertAsset(database, id, purpose, "image", null);
        return id;
      });
    }),
    uploadAudio: vi.fn(async (_context, upload) => {
      const id = nextAudio.shift();
      if (!id) throw new Error("Missing test audio ID");
      insertAsset(database, id, "member_audio", "audio", upload.originalName);
      return id;
    }),
  } as Pick<MediaService, "uploadImages" | "uploadAudio">;
  const port = new SqliteMemberMediaPort(executor, media, async () => ({
    maxProfileImageBytes: 1_000_000,
    maxProfileAudioBytes: 1_000_000,
    maxClassIconBytes: 1_000_000,
    maxProfileImages: 10,
  }));
  return { database, executor, media, port, nextImages, nextAudio };
}

function context() {
  return createRequestContext({
    requestId: "request-1", now: NOW,
    authorization: createAuthorizationContext({
      userId: "admin-1", sessionId: "session-1", roleId: "admin", roleLevel: 900,
      permissions: ["admin.users.edit"],
    }),
  });
}

function audit(
  id: string,
  action: AuditEventWrite["action"],
  subjectType: AuditEventWrite["subjectType"] = "member_profile",
  subjectId = "member-1",
): AuditEventWrite {
  return { ...createAuditEvent(context(), { subjectType, subjectId, action }), eventId: id };
}

function insertAsset(
  database: DatabaseSync,
  id: string,
  purpose: string,
  mediaType: "image" | "audio",
  originalName: string | null,
): void {
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, original_name, expires_at, created_at, updated_at
  ) VALUES (?, 'admin-1', ?, ?, 'staged', ?, '2026-08-10T12:00:00.000Z', ?, ?)`)
    .run(id, purpose, mediaType, originalName, NOW, NOW);
}

function link(database: DatabaseSync, mediaId: string, memberId: string, slot: string, sortOrder = 0): void {
  database.prepare(`INSERT INTO media_links (
    media_id, entity_type, entity_id, slot, audience, sort_order
  ) VALUES (?, 'member_profile', ?, ?, 'public', ?)`)
    .run(mediaId, memberId, slot, sortOrder);
}

function scalar(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = database.prepare(sql).get(...params) as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function text(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): string | null {
  const row = database.prepare(sql).get(...params) as Record<string, string | null>;
  return Object.values(row)[0] ?? null;
}

describe("SqliteMemberMediaPort composite media links", () => {
  it("replaces only the target avatar, keeps shared assets attached, and commits audit atomically", async () => {
    const value = harness();
    insertAsset(value.database, OLD_AVATAR, "member_avatar", "image", null);
    link(value.database, OLD_AVATAR, "member-1", "avatar");
    link(value.database, OLD_AVATAR, "member-2", "avatar");
    value.nextImages.push(NEW_AVATAR);

    const mediaId = await value.port.uploadAvatar(
      context(),
      "member-1",
      { full: new Uint8Array(), view: new Uint8Array() },
      audit("audit-avatar", "upload_avatar"),
      "profile-one-revision-0001",
    );

    expect(mediaId).toBe(NEW_AVATAR);
    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_id = 'member-1' AND slot = 'avatar'")).toBe(NEW_AVATAR);
    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_id = 'member-2' AND slot = 'avatar'")).toBe(OLD_AVATAR);
    expect(text(value.database, "SELECT state FROM media_assets WHERE id = ?", OLD_AVATAR)).toBe("attached");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-avatar'")).toBe(1);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-avatar");
    expect(text(value.database, "SELECT updated_at FROM member_profiles WHERE user_id = 'member-1'")).toBe(NOW);
  });

  it("attaches and reads profile images, then detaches them through the shared trigger lifecycle", async () => {
    const value = harness();
    value.nextImages.push(NEW_IMAGE);
    expect(await value.port.uploadProfileImages(
      context(), "member-1", [{ full: new Uint8Array(), view: new Uint8Array() }],
      audit("audit-image-upload", "upload_images"),
      "profile-one-revision-0001",
    )).toEqual([NEW_IMAGE]);
    expect((await value.port.listForMembers(["member-1"])).get("member-1")?.images).toEqual([NEW_IMAGE]);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-image-upload'")).toBe(1);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-image-upload");

    expect(await value.port.deleteProfileImages(
      context(), "member-1", [NEW_IMAGE, MISSING_IMAGE], audit("audit-image", "delete_images"),
      "profile-audit-image-upload",
    )).toBe(1);
    expect(text(value.database, "SELECT state FROM media_assets WHERE id = ?", NEW_IMAGE)).toBe("deleting");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-image'")).toBe(1);
    expect(JSON.parse(text(value.database, "SELECT payload_json FROM audit_log WHERE id = ?", "audit-image")!)).toEqual({
      schema_version: 2,
      changes: [],
      context: [{ field: "media_count", value: { type: "number", value: 1 } }],
    });
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-image");

    expect(await value.port.deleteProfileImages(
      context(), "member-1", [MISSING_IMAGE], audit("audit-image-noop", "delete_images"),
      "profile-audit-image",
    )).toBe(0);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-image");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-image-noop'")).toBe(0);
  });

  it("advances the aggregate root only for actual avatar and audio removals", async () => {
    const value = harness();
    insertAsset(value.database, OLD_AVATAR, "member_avatar", "image", null);
    insertAsset(value.database, OLD_AUDIO, "member_audio", "audio", "old.opus");
    link(value.database, OLD_AVATAR, "member-1", "avatar");
    link(value.database, OLD_AUDIO, "member-1", "audio");

    await expect(value.port.deleteAvatar(
      context(), "member-1", audit("audit-avatar-delete", "delete_avatar"), "profile-one-revision-0001",
    )).resolves.toBe(true);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-avatar-delete");

    await expect(value.port.deleteAvatar(
      context(), "member-1", audit("audit-avatar-noop", "delete_avatar"), "profile-audit-avatar-delete",
    )).resolves.toBe(false);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-avatar-delete");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-avatar-noop'")).toBe(0);

    await expect(value.port.deleteAudio(
      context(), "member-1", audit("audit-audio-delete", "delete_audio"), "profile-audit-avatar-delete",
    )).resolves.toBe(true);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-audit-audio-delete");
  });

  it("rejects a stale profile media mutation without changing links, audit, or the root revision", async () => {
    const value = harness();
    insertAsset(value.database, OLD_AVATAR, "member_avatar", "image", null);
    link(value.database, OLD_AVATAR, "member-1", "avatar");

    await expect(value.port.deleteAvatar(
      context(),
      "member-1",
      audit("audit-stale-avatar", "delete_avatar"),
      "profile-stale",
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_id = 'member-1' AND slot = 'avatar'"))
      .toBe(OLD_AVATAR);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-stale-avatar'")).toBe(0);
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'"))
      .toBe("profile-one-revision-0001");
  });

  it("rolls back profile image links when their audit insert fails and leaves the staged blob for GC", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, action, payload_json, occurred_at
    ) VALUES ('duplicate-image-audit', 'old', 'user', 'admin-1', NULL, 'member_profile',
      'member-1', NULL, 'upload_images', '{"schema_version":2,"changes":[],"context":[]}', ?)`).run(NOW);
    value.nextImages.push(NEW_IMAGE);

    await expect(value.port.uploadProfileImages(
      context(), "member-1", [{ full: new Uint8Array(), view: new Uint8Array() }],
      audit("duplicate-image-audit", "upload_images"),
      "profile-one-revision-0001",
    )).rejects.toThrow();
    expect(scalar(value.database, "SELECT count(*) FROM media_links WHERE media_id = ?", NEW_IMAGE)).toBe(0);
    expect(text(value.database, "SELECT state FROM media_assets WHERE id = ?", NEW_IMAGE)).toBe("staged");
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-one-revision-0001");
  });

  it("commits class icon metadata, link, and audit in one transaction", async () => {
    const value = harness();
    value.nextImages.push(CLASS_ICON);

    await expect(value.port.uploadClassIcon(
      context(), "class-1", { full: new Uint8Array(), view: new Uint8Array() },
      { expectedUpdatedAt: NOW, updatedAt: CLASS_ICON_UPDATED_AT },
      audit("audit-class-icon", "upload_icon", "class_catalog", "class-1"),
    )).resolves.toEqual({
      iconType: "image",
      vectorIcon: null,
      updatedAt: CLASS_ICON_UPDATED_AT,
      iconMediaId: CLASS_ICON,
    });
    expect(text(value.database, "SELECT icon_type FROM class_catalog WHERE id = 'class-1'")).toBe("image");
    expect(text(value.database, "SELECT vector_icon FROM class_catalog WHERE id = 'class-1'")).toBeNull();
    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_type = 'class_catalog' AND entity_id = 'class-1' AND slot = 'icon'")).toBe(CLASS_ICON);
    expect(text(value.database, "SELECT updated_at FROM class_catalog WHERE id = 'class-1'")).toBe(CLASS_ICON_UPDATED_AT);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-class-icon'")).toBe(1);
    expect(value.executor.batches[0]?.at(-1)).toMatchObject({
      method: "get",
      columns: ["icon_type", "vector_icon", "updated_at", "icon_media_id"],
    });
  });

  it("returns the committed vector snapshot when deleting a class icon", async () => {
    const value = harness();
    value.nextImages.push(CLASS_ICON);
    await value.port.uploadClassIcon(
      context(), "class-1", { full: new Uint8Array(), view: new Uint8Array() },
      { expectedUpdatedAt: NOW, updatedAt: CLASS_ICON_UPDATED_AT },
      audit("audit-class-icon-upload", "upload_icon", "class_catalog", "class-1"),
    );

    await expect(value.port.deleteClassIcon(
      context(), "class-1",
      { expectedUpdatedAt: CLASS_ICON_UPDATED_AT, updatedAt: "2026-08-09T12:00:02.000Z" },
      audit("audit-class-icon-delete", "delete", "class_catalog", "class-1"),
    )).resolves.toEqual({
      iconType: "vector",
      vectorIcon: "sword",
      updatedAt: "2026-08-09T12:00:02.000Z",
      iconMediaId: null,
    });
    expect(value.executor.batches[1]?.at(-1)).toMatchObject({
      method: "get",
      columns: ["icon_type", "vector_icon", "updated_at", "icon_media_id"],
    });
  });

  it("rolls back class links and audit when class metadata fails, leaving the staged blob for GC", async () => {
    const value = harness();
    value.database.exec(`CREATE TRIGGER reject_class_icon_metadata BEFORE UPDATE OF icon_type ON class_catalog
      BEGIN SELECT RAISE(ABORT, 'class metadata blocked'); END;`);
    value.nextImages.push(CLASS_ICON);

    await expect(value.port.uploadClassIcon(
      context(), "class-1", { full: new Uint8Array(), view: new Uint8Array() },
      { expectedUpdatedAt: NOW, updatedAt: CLASS_ICON_UPDATED_AT },
      audit("audit-class-failed", "upload_icon", "class_catalog", "class-1"),
    )).rejects.toThrow(/class metadata blocked/);
    expect(text(value.database, "SELECT icon_type FROM class_catalog WHERE id = 'class-1'")).toBe("vector");
    expect(scalar(value.database, "SELECT count(*) FROM media_links WHERE entity_type = 'class_catalog'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id = 'audit-class-failed'")).toBe(0);
    expect(text(value.database, "SELECT state FROM media_assets WHERE id = ?", CLASS_ICON)).toBe("staged");
  });

  it("rejects stale class icon upload and deletion baselines without changing links or audits", async () => {
    const value = harness();
    value.nextImages.push(CLASS_ICON);

    await expect(value.port.uploadClassIcon(
      context(), "class-1", { full: new Uint8Array(), view: new Uint8Array() },
      { expectedUpdatedAt: NOW, updatedAt: CLASS_ICON_UPDATED_AT },
      audit("audit-class-icon-current", "upload_icon", "class_catalog", "class-1"),
    )).resolves.toMatchObject({
      iconType: "image",
      vectorIcon: null,
      updatedAt: CLASS_ICON_UPDATED_AT,
      iconMediaId: CLASS_ICON,
    });

    value.nextImages.push(NEW_IMAGE);
    await expect(value.port.uploadClassIcon(
      context(), "class-1", { full: new Uint8Array(), view: new Uint8Array() },
      { expectedUpdatedAt: NOW, updatedAt: "2026-08-09T12:00:02.000Z" },
      audit("audit-class-icon-stale-upload", "upload_icon", "class_catalog", "class-1"),
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(value.port.deleteClassIcon(
      context(), "class-1",
      { expectedUpdatedAt: NOW, updatedAt: "2026-08-09T12:00:02.000Z" },
      audit("audit-class-icon-stale-delete", "delete", "class_catalog", "class-1"),
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(text(value.database, "SELECT icon_type FROM class_catalog WHERE id = 'class-1'")).toBe("image");
    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_type = 'class_catalog' AND entity_id = 'class-1' AND slot = 'icon'")).toBe(CLASS_ICON);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE id IN ('audit-class-icon-stale-upload', 'audit-class-icon-stale-delete')")).toBe(0);
  });

  it("rolls back an audio replacement when its audit insert fails", async () => {
    const value = harness();
    insertAsset(value.database, OLD_AUDIO, "member_audio", "audio", "old.opus");
    link(value.database, OLD_AUDIO, "member-1", "audio");
    value.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, action, payload_json, occurred_at
    ) VALUES ('duplicate-audit', 'old', 'user', 'admin-1', NULL, 'member_profile',
      'member-1', NULL, 'upload_audio', '{"schema_version":2,"changes":[],"context":[]}', ?)`).run(NOW);
    value.nextAudio.push(NEW_AUDIO);

    await expect(value.port.uploadAudio(
      context(),
      "member-1",
      { full: new Uint8Array(), originalName: "new.opus" },
      audit("duplicate-audit", "upload_audio"),
      "profile-one-revision-0001",
    )).rejects.toThrow();
    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_id = 'member-1' AND slot = 'audio'")).toBe(OLD_AUDIO);
    expect(text(value.database, "SELECT state FROM media_assets WHERE id = ?", OLD_AUDIO)).toBe("attached");
    expect(text(value.database, "SELECT state FROM media_assets WHERE id = ?", NEW_AUDIO)).toBe("staged");
    expect(text(value.database, "SELECT revision_token FROM member_profiles WHERE user_id = 'member-1'")).toBe("profile-one-revision-0001");
  });
});

describe("SqliteAbsencePolicyReader", () => {
  it("reads the canonical singleton policy through the portable SQL executor", async () => {
    const value = harness();
    await expect(new SqliteAbsencePolicyReader(value.executor).readAbsencePolicy())
      .resolves.toEqual({ maxSpanDays: 366, maxEntriesPerUser: 20 });
  });
});
