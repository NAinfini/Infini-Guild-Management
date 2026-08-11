import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_COLUMNS, LEGACY_SCHEMA, SOURCE_SCHEMA_SHA256, buildPhase1Migration, buildPhase2Migration, buildR2CopyManifest, parseLegacySnapshot, type LegacyTable } from "./migration.js";

const CORE = readFileSync(resolve("packages/persistence-sqlite/src/migrations/generated/0000_core.sql"), "utf8");
const NOW = "2026-08-10T00:00:00.000Z";
const OWNER = "owner-1";
const IMAGE_KEY = "members/owner-1/avatar/avatar.webp";

describe("production D1 blue-green mapping", () => {
  it("maps the real legacy shapes into bounded deterministic phase-1 batches without losing removed domains", () => {
    const snapshot = fixtureSnapshot();
    const first = buildPhase1Migration(snapshot, { siteOwnerUserIds: [OWNER] }, CORE);
    const second = buildPhase1Migration(snapshot, { siteOwnerUserIds: [OWNER] }, CORE);

    expect(first.ready).toBe(true);
    expect(first.batches).toEqual(second.batches);
    expect(first.batches.every((batch) => batch.statementCount <= 80)).toBe(true);
    expect(first.batches.flatMap((batch) => batch.sql).join("\n")).toContain("'site_owner'");
    expect(first.batches.flatMap((batch) => batch.sql).join("\n")).toContain("pbkdf2-sha256$10000$ABEiM0RVZneImaq7zN3u_w$");
    expect(first.batches.flatMap((batch) => batch.sql).join("\n")).toContain("'batch_add_by_moderator'");
    expect(first.batches.flatMap((batch) => batch.sql).join("\n")).toContain("'gallery', 'gallery-1', 'create'");
    expect(first.batches.flatMap((batch) => batch.sql).join("\n")).toContain("'scheduler'");
    expect(first.batches.flatMap((batch) => batch.sql).join("\n")).not.toContain("Temporarily");
    expect(first.report.transformations).toContainEqual(expect.objectContaining({ table: "events", rowKey: "event-1" }));
    expect(first.preservedRecords.map((record) => record.table)).toEqual(["game_data", "onboarding_config", "error_log_context"]);
    expect(first.report.coverage).toHaveLength(Object.keys(LEGACY_COLUMNS).length);
    expect(first.report.preserved.every((record) => /^[0-9a-f]{64}$/.test(record.sha256))).toBe(true);
    expect(first.mediaPlan).toHaveLength(1);
    const database = new DatabaseSync(":memory:");
    database.exec(CORE.replaceAll("--> statement-breakpoint", ""));
    const before = database.prepare("SELECT role_id, count(*) AS count FROM role_permissions WHERE role_id IN ('site_owner','admin','moderator','member') GROUP BY role_id ORDER BY role_id").all();
    for (const batch of first.batches) database.exec(batch.sql);
    const after = database.prepare("SELECT role_id, count(*) AS count FROM role_permissions WHERE role_id IN ('site_owner','admin','moderator','member') GROUP BY role_id ORDER BY role_id").all();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const auditRows = database.prepare("SELECT request_id, detail_json FROM audit_log ORDER BY id").all() as Array<{ request_id: string; detail_json: string }>;
    expect(auditRows.every(({ request_id }) => uuid.test(request_id))).toBe(true);
    expect(new Set(auditRows.map(({ request_id }) => request_id)).size).toBe(auditRows.length);
    expect(auditRows.map(({ detail_json }) => JSON.parse(detail_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_entity_type: "event_participant", source_action: "add_by_moderator", detail_text: "legacy" }),
    ]));
    expect(auditRows.some(({ detail_json }) => detail_json.includes("legacy_entity_type") || detail_json.includes("legacy_action"))).toBe(false);
    const generatedTokens = database.prepare(`SELECT revision_token AS value FROM users WHERE id = ?
      UNION ALL SELECT revision_token FROM member_profiles WHERE user_id = ?
      UNION ALL SELECT revision_token FROM announcements
      UNION ALL SELECT revision_token FROM gallery_items
      UNION ALL SELECT revision_token FROM wiki_articles
      UNION ALL SELECT revision_token FROM wiki_categories`).all(OWNER, OWNER) as Array<{ value: string }>;
    expect(generatedTokens.every(({ value }) => uuid.test(value))).toBe(true);
    const syntheticWikiRevision = database.prepare("SELECT id FROM wiki_revisions WHERE article_id = 'wiki-1'").get() as { id: string };
    expect(syntheticWikiRevision.id).toMatch(uuid);
    database.close();
    expect(after).toEqual(before);
  });

  it("builds an exact full/view R2 copy manifest and accepts phase 2 only after successful reconciliation", () => {
    const snapshot = fixtureSnapshot();
    const manifest = buildR2CopyManifest(snapshot, inventory([{ key: IMAGE_KEY, size: 123, contentType: "image/webp" }]));
    expect(manifest.objects.map((entry) => entry.variant)).toEqual(["full", "view"]);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const report = {
      version: 1,
      manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
      summary: { expected: 2, verified: 2, findings: 0 },
      objects: manifest.objects.map((entry) => ({ ...entry, sha256: "a".repeat(64), width: 64, height: 64 })),
      findings: [],
    };
    const phase2 = buildPhase2Migration(snapshot, { siteOwnerUserIds: [OWNER] }, manifestText, report, CORE);
    expect(phase2.ready).toBe(true);
    const sql = phase2.batches.map((batch) => batch.sql).join("\n");
    expect(sql).toContain("INSERT INTO \"media_assets\"");
    expect(sql).toContain("INSERT INTO \"media_links\"");

    expect(() => buildPhase2Migration(snapshot, { siteOwnerUserIds: [OWNER] }, manifestText, {
      ...report,
      summary: { expected: 2, verified: 1, findings: 1 },
      findings: [{ kind: "missing" }],
    }, CORE)).toThrow(/not fully successful/);
  });

  it("imports participants before restoring an archived past raffle and its draw", () => {
    const snapshot = fixtureSnapshot();
    snapshot.tables.events.rows.push(row("events", {
      id: "raffle-1", type: "raffle", title: "Past raffle", description: null,
      start_at: "2026-01-02T00:00:00.000Z", end_at: "2026-01-02T01:00:00.000Z", capacity: null,
      pinned: 0, signup_locked: 1, visible_at: "2026-01-02T00:00:00.000Z", archived_at: NOW,
      auto_archive: 1, auto_archived: 1, created_by: OWNER, updated_by: OWNER, series_id: null,
      instance_date: null, winner_count: 1, created_at: "2026-01-02T00:00:00.000Z", updated_at: NOW,
    }));
    snapshot.tables.event_participants.rows.push(row("event_participants", {
      id: "raffle-participant-1", event_id: "raffle-1", user_id: "member-1", joined_at: "2026-01-02T00:10:00.000Z",
    }));
    snapshot.tables.event_raffle_winners.rows.push(row("event_raffle_winners", {
      id: "raffle-winner-1", event_id: "raffle-1", user_id: "member-1", drawn_at: NOW,
    }));

    const bundle = buildPhase1Migration(snapshot, { siteOwnerUserIds: [OWNER] }, CORE);
    expect(bundle.ready).toBe(true);
    const database = new DatabaseSync(":memory:");
    database.exec(CORE.replaceAll("--> statement-breakpoint", ""));
    for (const batch of bundle.batches) database.exec(batch.sql);
    expect(database.prepare("SELECT type, end_at, capacity, archived_at, winner_count FROM events WHERE id = 'raffle-1'").get()).toEqual({
      type: "raffle", end_at: "2026-01-02T01:00:00.000Z", capacity: null, archived_at: NOW, winner_count: 1,
    });
    expect(database.prepare("SELECT count(*) AS count FROM event_raffle_winners WHERE event_id = 'raffle-1'").get()).toEqual({ count: 1 });
    database.close();
  });

  it("normalizes production legacy availability, new config defaults, and oversized audit details without loss", () => {
    const snapshot = fixtureSnapshot();
    snapshot.tables.member_profiles.rows[0]!.availability = JSON.stringify({
      active_times: [
        { startDay: 6, startMin: 1380, endDay: 7, endMin: 60 },
        { startDay: 7, startMin: 120, endDay: 7, endMin: 180 },
      ],
    });
    const siteConfig = snapshot.tables.site_config.rows[0]!;
    const mediaPolicy = JSON.parse(String(siteConfig.media_policy_json)) as { max_file_size_bytes: Record<string, number>; quotas: Record<string, number> };
    delete mediaPolicy.max_file_size_bytes.site_logo;
    delete mediaPolicy.max_file_size_bytes.storage_image;
    siteConfig.media_policy_json = JSON.stringify(mediaPolicy);
    snapshot.tables.audit_log.rows.push(row("audit_log", {
      id: "audit-oversized", entity_type: "member_profile", action: "update", actor_id: OWNER,
      entity_id: OWNER, diff_title: "Large detail", detail_text: "x".repeat(17_000), created_at: NOW,
    }));
    snapshot.tables.audit_log.rows.push(row("audit_log", {
      id: "audit-empty-summary", entity_type: "member_profile", action: "update", actor_id: OWNER,
      entity_id: OWNER, diff_title: "", detail_text: null, created_at: NOW,
    }));

    const bundle = buildPhase1Migration(snapshot, { siteOwnerUserIds: [OWNER] }, CORE);
    expect(bundle.ready).toBe(true);
    expect(bundle.preservedRecords).toContainEqual(expect.objectContaining({ table: "audit_log_oversized_detail", rowCount: 1 }));
    const database = new DatabaseSync(":memory:");
    database.exec(CORE.replaceAll("--> statement-breakpoint", ""));
    for (const batch of bundle.batches) database.exec(batch.sql);
    expect(database.prepare("SELECT weekday, start_minute, end_minute FROM member_availability_windows WHERE user_id = ? ORDER BY weekday, start_minute").all(OWNER)).toEqual([
      { weekday: 0, start_minute: 0, end_minute: 60 },
      { weekday: 0, start_minute: 120, end_minute: 180 },
      { weekday: 6, start_minute: 1380, end_minute: 1440 },
    ]);
    expect(database.prepare("SELECT max_site_logo_bytes, max_storage_image_bytes FROM site_config WHERE singleton = 1").get()).toEqual({
      max_site_logo_bytes: 2_097_152,
      max_storage_image_bytes: 5_242_880,
    });
    expect(database.prepare("SELECT detail_json FROM audit_log WHERE id = 'audit-oversized'").get()).toEqual(expect.objectContaining({
      detail_json: expect.stringContaining("audit_log_oversized_detail.ndjson"),
    }));
    expect(database.prepare("SELECT summary FROM audit_log WHERE id = 'audit-empty-summary'").get()).toEqual({ summary: null });
    database.close();
  });

  it("fails closed for unknown columns, inventory objects, and ineligible owner promotion", () => {
    const snapshot = fixtureSnapshot();
    const malformed = structuredClone(snapshot) as any;
    malformed.tables.users.columns.push("legacy_extra");
    malformed.tables.users.rows[0].legacy_extra = "x";
    expect(() => parseLegacySnapshot(malformed)).toThrow(/columns do not exactly match/);
    expect(() => buildPhase1Migration(malformed, { siteOwnerUserIds: [OWNER] })).toThrow(/columns do not exactly match/);
    const unknownTable = structuredClone(snapshot) as any;
    unknownTable.tables.legacy_extra = { columns: ["id"], rows: [{ id: "x" }] };
    expect(() => buildPhase1Migration(unknownTable, { siteOwnerUserIds: [OWNER] })).toThrow(/snapshot tables fields differ/);
    expect(() => buildR2CopyManifest(snapshot, inventory([
      { key: IMAGE_KEY, size: 123, contentType: "image/webp" },
      { key: "orphan.webp", size: 1, contentType: "image/webp" },
    ]))).toThrow(/does not exactly match/);
    expect(() => buildPhase1Migration(snapshot, { siteOwnerUserIds: [] })).toThrow(/At least one/);
    expect(() => buildPhase1Migration(snapshot, { siteOwnerUserIds: ["member-1"] })).toThrow(/active, non-deleted legacy admin/);
  });
});

function fixtureSnapshot() {
  const tables = Object.fromEntries((Object.keys(LEGACY_COLUMNS) as LegacyTable[]).map((table) => [table, {
    columns: [...LEGACY_COLUMNS[table]],
    rows: [] as Record<string, string | number | null>[],
  }])) as Record<LegacyTable, { columns: string[]; rows: Record<string, string | number | null>[] }>;
  tables.roles.rows.push(
    row("roles", { id: "admin", name: "Admin", level: 900, color: "#ff0000", created_at: NOW, updated_at: NOW }),
    row("roles", { id: "moderator", name: "Moderator", level: 500, color: "#00ff00", created_at: NOW, updated_at: NOW }),
    row("roles", { id: "member", name: "Member", level: 100, color: "#0000ff", created_at: NOW, updated_at: NOW }),
  );
  tables.role_permissions.rows.push(
    row("role_permissions", { role_id: "admin", permission: "admin.users.view", granted: 1 }),
    row("role_permissions", { role_id: "member", permission: "gallery.upload", granted: 1 }),
  );
  tables.users.rows.push(
    row("users", { id: OWNER, username: "owner", role: "admin", is_active: 1, deleted_at: null, created_at: NOW, updated_at: NOW }),
    row("users", { id: "member-1", username: "member", role: "member", is_active: 1, deleted_at: null, created_at: NOW, updated_at: NOW }),
  );
  tables.user_auth_password.rows.push(row("user_auth_password", {
    user_id: OWNER,
    password_hash: "pbkdf2-sha256$10000$EmkuNs85llMvx54FsKZiwKLn4lfvjY7uswwxuzCil0c=",
    salt: "ABEiM0RVZneImaq7zN3u/w==",
    updated_at: NOW,
  }));
  tables.member_profiles.rows.push(row("member_profiles", {
    id: "profile-1", user_id: OWNER, power: 10, title_html: null, bio: "bio", avatar_key: IMAGE_KEY, audio_key: null,
    video_urls: "[]", availability: JSON.stringify({ timezone: "UTC", days: { sunday: [], monday: [{ start_utc: "09:00", end_utc: "17:00" }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] } }),
    notes: null, created_at: NOW, updated_at: NOW,
  }));
  tables.wiki_categories.rows.push(row("wiki_categories", { id: "wiki-category-1", name: "General", slug: "general", sort_order: 0, parent_id: null, created_at: NOW, updated_at: NOW }));
  tables.wiki_articles.rows.push(row("wiki_articles", { id: "wiki-1", title: "Wiki", slug: "wiki", category_id: "wiki-category-1", body_json: "{}", sort_order: 0, pinned: 0, archived_at: null, created_by: OWNER, updated_by: OWNER, created_at: NOW, updated_at: NOW }));
  tables.announcements.rows.push(row("announcements", { id: "announcement-1", title: "Hello", body_json: "{}", pinned: 0, status: "published", publish_at: NOW, expires_at: null, archived_at: null, created_by: OWNER, updated_by: OWNER, created_at: NOW, updated_at: NOW }));
  tables.events.rows.push(row("events", { id: "event-1", type: "other", title: "Past event", description: null, start_at: "2026-01-01T00:00:00.000Z", end_at: "2026-01-01T01:00:00.000Z", capacity: 1, pinned: 0, signup_locked: 1, visible_at: "2026-01-01T00:00:00.000Z", archived_at: NOW, auto_archive: 1, auto_archived: 1, created_by: OWNER, updated_by: OWNER, series_id: null, instance_date: null, winner_count: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: NOW }));
  tables.event_participants.rows.push(row("event_participants", { id: "participant-1", event_id: "event-1", user_id: "member-1", joined_at: "2026-01-01T00:10:00.000Z" }));
  tables.gallery_items.rows.push(row("gallery_items", { id: "gallery-1", type: "video", url: "https://example.test/video", caption: null, uploaded_by: OWNER, created_at: NOW }));
  tables.audit_log.rows.push(
    row("audit_log", { id: "audit-1", entity_type: "event_participant", action: "add_by_moderator", actor_id: OWNER, entity_id: "event-1", diff_title: "Added", detail_text: "legacy", created_at: NOW }),
    row("audit_log", { id: "audit-2", entity_type: "gallery_comment", action: "create", actor_id: OWNER, entity_id: "gallery-1", diff_title: "Comment", detail_text: "legacy", created_at: NOW }),
  );
  tables.error_log.rows.push(row("error_log", { id: "error-1", source: "cron", level: "error", message: "failure", request_path: null, request_method: null, request_id: null, stack: null, context: "{\"job\":\"x\"}", created_at: NOW }));
  tables.game_data.rows.push(row("game_data", { id: "game-1", data: "{\"x\":1}", version: "v1", uploaded_by: OWNER, created_at: NOW }));
  tables.onboarding_config.rows.push(row("onboarding_config", { id: "default", title: "Welcome", body_json: "{}", checklist_json: "[]", require_ack: 1, published_at: NOW, updated_by: OWNER, created_at: NOW, updated_at: NOW }));
  tables.site_config.rows.push(row("site_config", {
    id: "default", site_name: "芳华照云阙", site_logo_url: "/guild-logo.webp",
    feature_flags_json: JSON.stringify({ announcements: true, events: true, guildWar: true, gallery: true, wiki: true, tools: true, storage: true, equipmentCalc: true }),
    media_policy_json: JSON.stringify({ max_file_size_bytes: { site_logo: 2_097_152, profile_image: 5_242_880, profile_audio: 20_971_520, announcement_image: 5_242_880, wiki_image: 5_242_880, event_image: 5_242_880, gallery_image: 10_485_760, storage_image: 5_242_880 }, quotas: { profile: 10, announcement: 10, gallery: 20, wiki: 10 } }),
    storage_policy_json: "{\"images_per_item\":5}", absence_policy_json: "{\"max_span_days\":366,\"max_entries_per_user\":20}",
    analytics_settings_json: "{\"reference_duration_minutes\":30,\"modifier_weights\":{\"kills\":0.3,\"towers\":0.1,\"base_hp\":0.15,\"credits\":0.3,\"distance\":0.15}}",
    created_at: NOW, updated_at: NOW,
  }));
  return { version: 1, schema: LEGACY_SCHEMA, schemaFingerprint: SOURCE_SCHEMA_SHA256, tables } as const;
}

function row(table: LegacyTable, values: Record<string, string | number | null>) {
  return Object.fromEntries(LEGACY_COLUMNS[table].map((column) => [column, values[column] ?? null]));
}

function inventory(objects: readonly { key: string; size: number; contentType: "image/webp" | "audio/ogg" }[]) {
  return {
    version: 1,
    source: { count: objects.length, objects: objects.map((object) => ({ ...object, etag: "etag", customMetadata: {}, checksum: null })) },
    target: { count: 0, objects: [] },
  };
}
