import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migration-test-utils";

describe("core schema query plans", () => {
  let db: DatabaseSync;

  beforeAll(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);
  });

  afterAll(() => db.close());

  function plan(sql: string, ...bindings: Array<string | number>): string {
    return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings)
      .map((row) => String((row as { detail?: unknown }).detail ?? ""))
      .join("\n");
  }

  function expectStableIndex(queryPlan: string, indexName: string) {
    expect(queryPlan).toContain(indexName);
    expect(queryPlan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/i);
  }

  it("covers stable audit lists for unfiltered, entity+actor, entity, and actor paths", () => {
    const tail = "created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 50";
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE ${tail}`, "2026-01-01", "2026-12-31"), "idx_audit_log_created_at");
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE entity_type = ? AND actor_id = ? AND ${tail}`, "event", "u", "2026-01-01", "2026-12-31"), "idx_audit_log_entity_actor_created");
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE entity_type = ? AND ${tail}`, "event", "2026-01-01", "2026-12-31"), "idx_audit_log_entity_created");
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE actor_id = ? AND ${tail}`, "u", "2026-01-01", "2026-12-31"), "idx_audit_log_actor_created");
  });

  it("covers stable error lists with and without a source filter", () => {
    expectStableIndex(plan("SELECT * FROM error_log ORDER BY created_at DESC, id DESC LIMIT 50"), "idx_error_log_created_at");
    expectStableIndex(plan("SELECT * FROM error_log WHERE source = ? ORDER BY created_at DESC, id DESC LIMIT 50", "request"), "idx_error_log_source_created");
  });

  it("covers stable storage ledger lists on every supported filter path", () => {
    expectStableIndex(plan("SELECT * FROM storage_transactions ORDER BY created_at DESC, id DESC LIMIT 50"), "idx_storage_transactions_created");
    expectStableIndex(plan("SELECT * FROM storage_transactions WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", "item"), "idx_storage_transactions_item");
    expectStableIndex(plan("SELECT * FROM storage_transactions WHERE recipient_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", "user"), "idx_storage_transactions_recipient");
    expectStableIndex(plan("SELECT * FROM storage_transactions WHERE actor_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", "user"), "idx_storage_transactions_actor");
    expectStableIndex(plan("SELECT * FROM storage_transactions WHERE batch_id = ? ORDER BY batch_position", "storage-batch-id"), "ux_storage_transactions_batch_position");
    expectStableIndex(plan("SELECT * FROM storage_batches WHERE actor_id = ? ORDER BY created_at DESC, id DESC", "user"), "idx_storage_batches_actor_created");
  });

  it("covers expired-media cleanup and ordered entity links", () => {
    expectStableIndex(
      plan("SELECT id FROM media_assets WHERE expires_at <= ? ORDER BY expires_at, id", "2026-08-08T19:00:00.000Z"),
      "idx_media_assets_expiry",
    );
    expectStableIndex(
      plan("SELECT media_id FROM media_links WHERE entity_type = ? AND entity_id = ? AND slot = ? ORDER BY sort_order", "event", "event-1", "attachment"),
      "ux_media_links_entity_slot_sort",
    );
    expectStableIndex(
      plan("SELECT id FROM media_assets WHERE owner_user_id = ? AND purpose = ? AND state = 'pending' AND expires_at > ? ORDER BY expires_at, id", "user-1", "wiki_image", "2026-08-08T19:00:00.000Z"),
      "idx_media_assets_owner_purpose_state_expiry",
    );
  });

  it("covers normalized guild-war history and member-stat reads", () => {
    expectStableIndex(
      plan("SELECT own_kills, enemy_kills FROM war_history ORDER BY created_at DESC, id DESC LIMIT 20"),
      "idx_war_history_created",
    );

    const memberPlan = plan(
      `SELECT war_team_members.user_id, war_team_members.kills, war_team_members.damage_taken
       FROM war_team_members
       INNER JOIN war_teams ON war_teams.id = war_team_members.war_team_id
       WHERE war_teams.war_history_id = ?`,
      "history-1",
    );
    expect(memberPlan).toContain("idx_war_teams_history_sort");
    expect(memberPlan).toMatch(/(?:idx_war_team_members_team_sort|ux_war_team_members_team_user)/);
  });

  it("covers normalized availability and recurring-weekday lookups", () => {
    expectStableIndex(
      plan(
        `SELECT user_id FROM member_availability_windows
         WHERE weekday = ? AND start_minute < ? AND end_minute > ?
         ORDER BY start_minute, end_minute, user_id`,
        1,
        1020,
        540,
      ),
      "idx_member_availability_windows_lookup",
    );
    expectStableIndex(
      plan(
        `SELECT template_id FROM recurring_template_weekdays
         WHERE weekday = ? ORDER BY template_id`,
        1,
      ),
      "idx_recurring_template_weekdays_weekday_template",
    );
  });

  it("uses the singleton primary key for site-policy reads without a second index", () => {
    const siteConfigPlan = plan(
      `SELECT feature_announcements_enabled, media_profile_image_max_bytes,
        storage_images_per_item, absence_max_span_days, analytics_kills_weight
       FROM site_config WHERE id = ?`,
      "default",
    );

    expect(siteConfigPlan).toContain("sqlite_autoindex_site_config_1");
  });
});
