import { DatabaseSync } from "node:sqlite";
import {
  type MediaPurpose,
  type MediaType,
} from "@guild/shared/constants/media";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migration-test-utils";

const USER_1_ID = "111111111111111111111";
const USER_2_ID = "222222222222222222222";

function insertReadyAsset(
  db: DatabaseSync,
  id: string,
  purpose: MediaPurpose,
  mediaType: MediaType,
  ownerUserId: string | null = null,
): void {
  db.prepare(
    `INSERT INTO media_assets
      (id, owner_user_id, purpose, original_name, media_type, state, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', '2099-01-01T00:00:00.000Z')`,
  ).run(id, ownerUserId, purpose, mediaType === "audio" ? "recording.ogg" : null, mediaType);
  const insertVariant = db.prepare(
    "INSERT INTO media_variants (media_id, variant, byte_size, width, height) VALUES (?, ?, ?, ?, ?)",
  );
  insertVariant.run(id, "full", 100, mediaType === "image" ? 100 : null, mediaType === "image" ? 80 : null);
  if (mediaType === "image") insertVariant.run(id, "view", 80, 100, 80);
  db.prepare("UPDATE media_assets SET state = 'ready' WHERE id = ?").run(id);
}

describe("core schema integrity constraints", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run(USER_1_ID, "user-one", "member");
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run(USER_2_ID, "user-two", "member");
  });

  afterEach(() => db.close());

  it("requires every persisted user id to be a 21-character URL-safe nanoid", () => {
    const insert = db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, 'member')");

    expect(() => insert.run("short", "short-id")).toThrow(/users_id_nanoid/i);
    expect(() => insert.run("aaaaaaaaaaaaaaaaaaaa/", "unsafe-id")).toThrow(/users_id_nanoid/i);
  });

  it("stores audit details and error contexts only as JSON objects or SQL NULL", () => {
    const insertAudit = db.prepare(
      "INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id, detail_text) VALUES (?, 'event', 'update', ?, 'event-1', ?)",
    );
    insertAudit.run("audit-object", USER_1_ID, '{"changed":true}');
    insertAudit.run("audit-null", USER_1_ID, null);
    expect(() => insertAudit.run("audit-text", USER_1_ID, "not-json")).toThrow(/audit_log_detail_object/i);
    expect(() => insertAudit.run("audit-array", USER_1_ID, "[]")).toThrow(/audit_log_detail_object/i);
    expect(() => insertAudit.run("audit-scalar", USER_1_ID, "null")).toThrow(/audit_log_detail_object/i);

    const insertError = db.prepare(
      "INSERT INTO error_log (id, source, message, context) VALUES (?, 'request', 'failed', ?)",
    );
    insertError.run("error-object", '{"request_id":"request-1"}');
    insertError.run("error-null", null);
    expect(() => insertError.run("error-text", "not-json")).toThrow(/error_log_context_object/i);
    expect(() => insertError.run("error-array", "[]")).toThrow(/error_log_context_object/i);
    expect(() => insertError.run("error-scalar", "true")).toThrow(/error_log_context_object/i);
  });

  it("rejects values outside the fixed permission, audit, error, and artifact enums", () => {
    expect(() => db.prepare(
      "INSERT INTO role_permissions (role_id, permission) VALUES ('member', 'unknown.permission')",
    ).run()).toThrow(/role_permissions_permission_valid/i);
    expect(() => db.prepare(
      "INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id) VALUES ('bad-entity', 'unknown', 'update', ?, 'x')",
    ).run(USER_1_ID)).toThrow(/audit_log_entity_type_valid/i);
    expect(() => db.prepare(
      "INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id) VALUES ('bad-action', 'event', 'unknown', ?, 'x')",
    ).run(USER_1_ID)).toThrow(/audit_log_action_valid/i);
    expect(() => db.prepare(
      "INSERT INTO error_log (id, source, level, message) VALUES ('bad-source', 'worker', 'error', 'x')",
    ).run()).toThrow(/error_log_source_valid/i);
    expect(() => db.prepare(
      "INSERT INTO error_log (id, source, level, message) VALUES ('bad-level', 'request', 'info', 'x')",
    ).run()).toThrow(/error_log_level_valid/i);

    db.prepare("INSERT INTO system_test_runs (id, actor_id) VALUES ('run-enum', ?)").run(USER_1_ID);
    expect(() => db.prepare(
      "INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key) VALUES ('run-enum', 'unknown', 'x')",
    ).run()).toThrow(/system_test_artifacts_artifact_type_valid/i);
  });

  it("enforces the explicit boolean and nonnegative ordering/count contracts", () => {
    expect(() => db.prepare("UPDATE users SET is_active = 2 WHERE id = ?").run(USER_1_ID))
      .toThrow(/users_is_active_boolean/i);
    expect(() => db.prepare(
      "INSERT INTO announcements (id, title, body_json, pinned, created_by) VALUES ('bad-pin', 'x', '{}', 2, ?)",
    ).run(USER_1_ID)).toThrow(/announcements_pinned_boolean/i);
    expect(() => db.prepare(
      "INSERT INTO member_badges (id, name, label_html, sort_order) VALUES ('bad-badge', 'x', 'x', -1)",
    ).run()).toThrow(/member_badges_sort_nonnegative/i);
    expect(() => db.prepare(
      "INSERT INTO login_failures (username, fail_count) VALUES ('bad-count', -1)",
    ).run()).toThrow(/login_failures_fail_count_nonnegative/i);
    expect(() => db.prepare(
      "INSERT INTO system_test_runs (id, actor_id, cleanup_attempts) VALUES ('bad-cleanup', ?, -1)",
    ).run(USER_1_ID)).toThrow(/system_test_runs_cleanup_attempts_nonnegative/i);

    db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES ('event-checks', 'poll', 'Checks', '2026-08-01T00:00:00.000Z', ?)")
      .run(USER_1_ID);
    expect(() => db.prepare(
      "INSERT INTO event_polls (event_id, show_voter_names) VALUES ('event-checks', 2)",
    ).run()).toThrow(/event_polls_show_voter_names_boolean/i);
    expect(() => db.prepare(
      "INSERT INTO event_poll_options (id, event_id, label, sort_order) VALUES ('bad-option', 'event-checks', 'x', -1)",
    ).run()).toThrow(/event_poll_options_sort_nonnegative/i);
    expect(() => db.prepare(
      "INSERT INTO war_teams (id, event_id, team_name, sort_order) VALUES ('bad-team-sort', 'event-checks', 'x', -1)",
    ).run()).toThrow(/war_teams_sort_nonnegative/i);
    expect(() => db.prepare(
      "INSERT INTO war_teams (id, event_id, team_name, is_locked) VALUES ('bad-team-lock', 'event-checks', 'x', 2)",
    ).run()).toThrow(/war_teams_is_locked_boolean/i);
    db.prepare("INSERT INTO war_teams (id, event_id, team_name) VALUES ('team-checks', 'event-checks', 'x')").run();
    expect(() => db.prepare(
      "INSERT INTO war_team_members (id, war_team_id, user_id, sort_order) VALUES ('bad-member-sort', 'team-checks', ?, -1)",
    ).run(USER_1_ID)).toThrow(/war_team_members_sort_nonnegative/i);

    db.prepare("INSERT INTO storages (id, name) VALUES ('storage-checks', 'x')").run();
    expect(() => db.prepare(
      "INSERT INTO storage_items (id, storage_id, name, allow_member_deposit) VALUES ('bad-storage-flag', 'storage-checks', 'x', 2)",
    ).run()).toThrow(/storage_items_boolean_flags_valid/i);
    expect(() => db.prepare(
      "INSERT INTO wiki_categories (id, name, slug, sort_order) VALUES ('bad-wiki-category', 'x', 'bad-wiki-category', -1)",
    ).run()).toThrow(/wiki_categories_sort_nonnegative/i);
    db.prepare("INSERT INTO wiki_categories (id, name, slug) VALUES ('wiki-checks', 'x', 'wiki-checks')").run();
    expect(() => db.prepare(
      "INSERT INTO wiki_articles (id, title, slug, category_id, body_json, sort_order, created_by) VALUES ('bad-wiki-sort', 'x', 'bad-wiki-sort', 'wiki-checks', '{}', -1, ?)",
    ).run(USER_1_ID)).toThrow(/wiki_articles_sort_nonnegative/i);
    expect(() => db.prepare(
      "INSERT INTO wiki_articles (id, title, slug, category_id, body_json, pinned, created_by) VALUES ('bad-wiki-pin', 'x', 'bad-wiki-pin', 'wiki-checks', '{}', 2, ?)",
    ).run(USER_1_ID)).toThrow(/wiki_articles_pinned_boolean/i);
    db.prepare("INSERT INTO wiki_articles (id, title, slug, category_id, body_json, created_by) VALUES ('wiki-checks', 'x', 'wiki-checks', 'wiki-checks', '{}', ?)")
      .run(USER_1_ID);
    expect(() => db.prepare(
      "INSERT INTO wiki_revisions (id, article_id, revision, title, body_json, edited_by) VALUES ('bad-revision', 'wiki-checks', 0, 'x', '{}', ?)",
    ).run(USER_1_ID)).toThrow(/wiki_revisions_revision_positive/i);
    expect(() => db.prepare(
      "INSERT INTO wiki_revisions (id, article_id, revision, title, body_json, edited_by, restored_from) VALUES ('bad-restored', 'wiki-checks', 1, 'x', '{}', ?, 0)",
    ).run(USER_1_ID)).toThrow(/wiki_revisions_restored_from_positive/i);
  });

  it("requires canonical UTC timestamps and dates on the explicit business fields", () => {
    expect(() => db.prepare(
      "INSERT INTO events (id, type, title, start_at, created_by) VALUES ('bad-event-time', 'other', 'x', '2026-08-01T00:00:00Z', ?)",
    ).run(USER_1_ID)).toThrow(/events_times_valid/i);
    expect(() => db.prepare(
      "INSERT INTO events (id, type, title, start_at, end_at, created_by) VALUES ('bad-event-range', 'other', 'x', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', ?)",
    ).run(USER_1_ID)).toThrow(/events_times_valid/i);
    expect(() => db.prepare(
      "INSERT INTO member_absences (id, user_id, start_date, end_date) VALUES ('bad-absence-date', ?, '2026-02-30', '2026-03-01')",
    ).run(USER_1_ID)).toThrow(/member_absences_dates_valid/i);
    expect(() => db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_frequency, recurrence_interval, recurrence_end_at, created_by)
       VALUES ('bad-template-time', 'other', 'x', '10:00', 'daily', 1, '2026-08-01', ?)`,
    ).run(USER_1_ID)).toThrow(/recurring_templates_recurrence_end_valid/i);
    expect(() => db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_frequency, recurrence_interval, last_generated_date, created_by)
       VALUES ('bad-template-date', 'other', 'x', '10:00', 'daily', 1, '2026-02-30', ?)`,
    ).run(USER_1_ID)).toThrow(/recurring_templates_last_generated_date_valid/i);
    expect(() => db.prepare(
      "INSERT INTO announcements (id, title, body_json, publish_at, created_by) VALUES ('bad-announcement-time', 'x', '{}', '2026-08-01', ?)",
    ).run(USER_1_ID)).toThrow(/announcements_times_valid/i);
    expect(() => db.prepare(
      "INSERT INTO invite_links (id, code, created_by, role_id, max_uses, expires_at) VALUES ('bad-invite-time', 'bad-time', ?, 'member', 1, '2026-08-01')",
    ).run(USER_1_ID)).toThrow(/invite_links_times_valid/i);
    expect(() => db.prepare(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ('bad-session-time', ?, '2026-08-01')",
    ).run(USER_1_ID)).toThrow(/sessions_expires_at_valid/i);
    expect(() => db.prepare(
      "INSERT INTO login_failures (username, locked_until) VALUES ('bad-lock-time', '2026-08-01')",
    ).run()).toThrow(/login_failures_locked_until_valid/i);
    expect(() => db.prepare(
      `INSERT INTO media_assets
        (id, purpose, media_type, state, expires_at)
       VALUES ('ddddddddddddddddddddd', 'event_image', 'image', 'pending', '2026-08-01')`,
    ).run()).toThrow(/media_assets_expires_at_valid/i);
    db.prepare("INSERT INTO wiki_categories (id, name, slug) VALUES ('wiki-time', 'x', 'wiki-time')").run();
    expect(() => db.prepare(
      "INSERT INTO wiki_articles (id, title, slug, category_id, body_json, archived_at, created_by) VALUES ('bad-wiki-time', 'x', 'bad-wiki-time', 'wiki-time', '{}', '2026-08-01', ?)",
    ).run(USER_1_ID)).toThrow(/wiki_articles_archived_at_valid/i);
  });

  it("rejects participant, raffle, team, pool, and category orphan rows", () => {
    expect(() => db.prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)").run("p-1", "missing", USER_1_ID))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO event_raffle_winners (id, event_id, user_id) VALUES (?, ?, ?)").run("r-1", "missing", USER_1_ID))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO war_team_members (id, war_team_id, user_id) VALUES (?, ?, ?)").run("m-1", "missing", USER_1_ID))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO war_pool_members (id, event_id, user_id) VALUES (?, ?, ?)").run("pool-1", "missing", USER_1_ID))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO wiki_categories (id, name, slug, parent_id) VALUES (?, ?, ?, ?)").run("child", "Child", "child", "missing"))
      .toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a poll vote whose option belongs to a different event", () => {
    const insertEvent = db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'poll', ?, ?, ?)");
    insertEvent.run("event-1", "One", "2026-08-01T00:00:00.000Z", USER_1_ID);
    insertEvent.run("event-2", "Two", "2026-08-01T00:00:00.000Z", USER_1_ID);
    db.prepare("INSERT INTO event_poll_options (id, event_id, label) VALUES (?, ?, ?)").run("option-1", "event-1", "A");

    expect(() => db.prepare(
      "INSERT INTO event_poll_votes (event_id, option_id, user_id) VALUES (?, ?, ?)",
    ).run("event-2", "option-1", USER_2_ID)).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("requires exactly one parent for active and historical war rows", () => {
    db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'guild_war', ?, ?, ?)")
      .run("event-1", "War", "2026-08-01T00:00:00.000Z", USER_1_ID);
    db.prepare("INSERT INTO war_history (id, event_id, war_name, created_by) VALUES (?, ?, ?, ?)")
      .run("history-1", "event-1", "History", USER_1_ID);

    expect(() => db.prepare("INSERT INTO war_teams (id, team_name) VALUES (?, ?)").run("team-none", "None"))
      .toThrow(/war_teams_exactly_one_parent/i);
    expect(() => db.prepare("INSERT INTO war_teams (id, war_history_id, event_id, team_name) VALUES (?, ?, ?, ?)")
      .run("team-both", "history-1", "event-1", "Both")).toThrow(/war_teams_exactly_one_parent/i);
    expect(() => db.prepare("INSERT INTO war_pool_members (id, user_id) VALUES (?, ?)").run("pool-none", USER_1_ID))
      .toThrow(/war_pool_members_exactly_one_parent/i);
    expect(() => db.prepare("INSERT INTO war_pool_members (id, war_history_id, event_id, user_id) VALUES (?, ?, ?, ?)")
      .run("pool-both", "history-1", "event-1", USER_1_ID)).toThrow(/war_pool_members_exactly_one_parent/i);
  });

  it("keeps every normalized guild-war statistic nullable and nonnegative", () => {
    const insertHistory = db.prepare(
      `INSERT INTO war_history
        (id, war_name, own_kills, enemy_distance, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    );

    expect(() => insertHistory.run("history-own-negative", "Bad own", -1, null, USER_1_ID))
      .toThrow(/war_history_stats_nonnegative/i);
    expect(() => insertHistory.run("history-enemy-negative", "Bad enemy", null, -1, USER_1_ID))
      .toThrow(/war_history_stats_nonnegative/i);
    insertHistory.run("history-valid", "Valid", 0, null, USER_1_ID);

    db.prepare("INSERT INTO war_teams (id, war_history_id, team_name) VALUES (?, ?, ?)")
      .run("team-valid", "history-valid", "Alpha");
    expect(() => db.prepare(
      "INSERT INTO war_team_members (id, war_team_id, user_id, damage_taken) VALUES (?, ?, ?, ?)",
    ).run("member-negative", "team-valid", USER_1_ID, -1))
      .toThrow(/war_team_members_stats_nonnegative/i);
    db.prepare(
      "INSERT INTO war_team_members (id, war_team_id, user_id, kills, damage_taken) VALUES (?, ?, ?, ?, ?)",
    ).run("member-valid", "team-valid", USER_1_ID, 0, null);
  });

  it("rejects inverted absence dates", () => {
    expect(() => db.prepare(
      "INSERT INTO member_absences (id, user_id, start_date, end_date) VALUES (?, ?, ?, ?)",
    ).run("absence-1", USER_1_ID, "2026-08-10", "2026-08-01")).toThrow(/member_absences_date_range_valid/i);
  });

  it("normalizes member availability rows and rejects overlapping inserts and updates", () => {
    const insertProfile = db.prepare(
      "INSERT INTO member_profiles (user_id, availability_timezone) VALUES (?, ?)",
    );
    insertProfile.run(USER_1_ID, "UTC");
    insertProfile.run(USER_2_ID, "America/New_York");

    expect(() => db.prepare(
      "UPDATE member_profiles SET availability_timezone = ' UTC' WHERE user_id = ?",
    ).run(USER_1_ID)).toThrow(/member_profiles_availability_timezone_valid/i);
    expect(() => db.prepare(
      "UPDATE member_profiles SET availability_timezone = ? WHERE user_id = ?",
    ).run("a".repeat(65), USER_1_ID)).toThrow(/member_profiles_availability_timezone_valid/i);
    db.prepare(
      "UPDATE member_profiles SET availability_timezone = 'Mars\/Olympus' WHERE user_id = ?",
    ).run(USER_1_ID);

    const insertWindow = db.prepare(
      "INSERT INTO member_availability_windows (user_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)",
    );
    insertWindow.run(USER_1_ID, 1, 60, 120);
    insertWindow.run(USER_1_ID, 1, 120, 180);
    insertWindow.run(USER_1_ID, 2, 90, 150);
    insertWindow.run(USER_2_ID, 1, 90, 150);

    expect(() => insertWindow.run(USER_1_ID, 1, 119, 121))
      .toThrow(/member_availability_windows_overlap/i);
    expect(() => insertWindow.run(USER_1_ID, 7, 60, 120))
      .toThrow(/member_availability_windows_weekday_valid/i);
    expect(() => insertWindow.run(USER_1_ID, 1, 180, 180))
      .toThrow(/member_availability_windows_range_valid/i);
    expect(() => db.prepare(
      `UPDATE member_availability_windows
       SET start_minute = 119
       WHERE user_id = ? AND weekday = 1 AND start_minute = 120 AND end_minute = 180`,
    ).run(USER_1_ID)).toThrow(/member_availability_windows_overlap/i);

    db.prepare("DELETE FROM member_profiles WHERE user_id = ?").run(USER_1_ID);
    expect(db.prepare(
      "SELECT COUNT(*) AS n FROM member_availability_windows WHERE user_id = ?",
    ).get(USER_1_ID)).toEqual({ n: 0 });
  });

  it("enforces fixed recurrence columns, weekday rows, and event series identity", () => {
    db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, duration_minutes, recurrence_frequency,
         recurrence_interval, visibility_offset_minutes, auto_archive, paused,
         created_by, generation_count)
       VALUES ('template-1', 'other', 'Template', '19:00', 60, 'daily', 1, 0, 0, 0, ?, 0)`,
    ).run(USER_1_ID);
    const updateTemplate = (assignment: string) => db.prepare(
      `UPDATE recurring_templates SET ${assignment} WHERE id = 'template-1'`,
    ).run();

    expect(() => updateTemplate("start_time = '24:00'"))
      .toThrow(/recurring_templates_start_time_valid/i);
    expect(() => updateTemplate("duration_minutes = -1"))
      .toThrow(/recurring_templates_duration_nonnegative/i);
    expect(() => updateTemplate("visibility_offset_minutes = -1"))
      .toThrow(/recurring_templates_visibility_offset_nonnegative/i);
    expect(() => updateTemplate("generation_count = -1"))
      .toThrow(/recurring_templates_generation_count_nonnegative/i);
    expect(() => updateTemplate("auto_archive = 2"))
      .toThrow(/recurring_templates_boolean_flags_valid/i);
    expect(() => updateTemplate("paused = -1"))
      .toThrow(/recurring_templates_boolean_flags_valid/i);
    expect(() => updateTemplate("recurrence_interval = 0"))
      .toThrow(/recurring_templates_recurrence_valid/i);
    expect(() => updateTemplate("recurrence_day_of_month = 1"))
      .toThrow(/recurring_templates_recurrence_valid/i);
    expect(() => updateTemplate("recurrence_frequency = 'monthly'"))
      .toThrow(/recurring_templates_recurrence_valid/i);
    expect(() => updateTemplate("recurrence_end_after = 0"))
      .toThrow(/recurring_templates_recurrence_end_valid/i);
    expect(() => updateTemplate("recurrence_end_at = 'not-a-date'"))
      .toThrow(/recurring_templates_recurrence_end_valid/i);
    expect(() => updateTemplate(
      "recurrence_end_after = 2, recurrence_end_at = '2026-12-01T00:00:00.000Z'",
    )).toThrow(/recurring_templates_recurrence_end_valid/i);

    updateTemplate(
      "recurrence_frequency = 'monthly', recurrence_day_of_month = 31, recurrence_end_at = '2026-12-01T00:00:00.000Z'",
    );
    db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_frequency, recurrence_interval, created_by)
       VALUES ('template-weekly', 'other', 'Weekly', '19:00', 'weekly', 1, ?)`,
    ).run(USER_1_ID);
    db.prepare(
      "INSERT INTO recurring_template_weekdays (template_id, weekday) VALUES ('template-weekly', 1)",
    ).run();
    db.prepare(
      "INSERT INTO recurring_template_weekdays (template_id, weekday) VALUES ('template-weekly', 3)",
    ).run();
    expect(() => db.prepare(
      "INSERT INTO recurring_template_weekdays (template_id, weekday) VALUES ('template-weekly', 7)",
    ).run()).toThrow(/recurring_template_weekdays_weekday_valid/i);
    expect(() => db.prepare(
      "INSERT INTO recurring_template_weekdays (template_id, weekday) VALUES ('template-weekly', 1)",
    ).run()).toThrow(/UNIQUE constraint failed/i);

    expect(() => db.prepare(
      `INSERT INTO events (id, type, title, start_at, created_by, series_id)
       VALUES ('event-series-only', 'other', 'Series', '2026-08-01T00:00:00.000Z', ?, 'template-weekly')`,
    ).run(USER_1_ID)).toThrow(/events_series_instance_pair/i);
    expect(() => db.prepare(
      `INSERT INTO events (id, type, title, start_at, created_by, instance_date)
       VALUES ('event-instance-only', 'other', 'Instance', '2026-08-01T00:00:00.000Z', ?, '2026-08-01')`,
    ).run(USER_1_ID)).toThrow(/events_series_instance_pair/i);
    expect(() => db.prepare(
      `INSERT INTO events (id, type, title, start_at, created_by, series_id, instance_date)
       VALUES ('event-missing-series', 'other', 'Missing', '2026-08-01T00:00:00.000Z', ?, 'missing', '2026-08-01')`,
    ).run(USER_1_ID)).toThrow(/FOREIGN KEY constraint failed/i);
    db.prepare(
      `INSERT INTO events (id, type, title, start_at, created_by, series_id, instance_date)
       VALUES ('event-series', 'other', 'Series', '2026-08-01T00:00:00.000Z', ?, 'template-weekly', '2026-08-01')`,
    ).run(USER_1_ID);
  });

  it("rejects gallery and poll values outside their static enums", () => {
    db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'poll', ?, ?, ?)")
      .run("event-enum", "Enum poll", "2026-08-01T00:00:00.000Z", USER_1_ID);

    expect(() => db.prepare(
      "INSERT INTO event_polls (event_id, results_visibility) VALUES (?, ?)",
    ).run("event-enum", "admin_only")).toThrow(/CHECK constraint failed/i);
    expect(() => db.prepare(
      "INSERT INTO gallery_items (id, type, url, uploaded_by) VALUES (?, ?, ?, ?)",
    ).run("gallery-enum", "audio", "media/audio", USER_1_ID)).toThrow(/CHECK constraint failed/i);
  });

  it("enforces media asset identity, state, purpose, and variant metadata", () => {
    const insertAsset = db.prepare(
      `INSERT INTO media_assets
        (id, purpose, original_name, media_type, state, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    expect(() => insertAsset.run("short", "event_image", null, "image", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_id_nanoid/i);
    expect(() => insertAsset.run("aaaaaaaaaaaaaaaaaaaa/", "event_image", null, "image", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_id_nanoid/i);
    expect(() => insertAsset.run("aaaaaaaaaaaaaaaaaaaaa", "unknown", null, "image", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_purpose_valid/i);
    expect(() => insertAsset.run("aaaaaaaaaaaaaaaaaaaaa", "member_audio", null, "image", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_purpose_type_consistent/i);
    expect(() => insertAsset.run("aaaaaaaaaaaaaaaaaaaaa", "event_image", null, "image", "pending", null))
      .toThrow(/media_assets_pending_expiry_required/i);
    expect(() => insertAsset.run("aaaaaaaaaaaaaaaaaaaaa", "event_image", "image.webp", "image", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_original_name_contract/i);
    expect(() => insertAsset.run("bbbbbbbbbbbbbbbbbbbbb", "member_audio", "   ", "audio", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_original_name_contract/i);
    expect(() => insertAsset.run("bbbbbbbbbbbbbbbbbbbbb", "member_audio", "a".repeat(256), "audio", "pending", "2026-08-08T19:00:00.000Z"))
      .toThrow(/media_assets_original_name_contract/i);
    expect(() => insertAsset.run("ccccccccccccccccccccc", "event_image", null, "image", "ready", null))
      .toThrow(/media_assets_must_start_pending/i);

    insertAsset.run("aaaaaaaaaaaaaaaaaaaaa", "event_image", null, "image", "pending", "2099-01-01T00:00:00.000Z");
    insertAsset.run("bbbbbbbbbbbbbbbbbbbbb", "member_audio", "recording.ogg", "audio", "pending", "2099-01-01T00:00:00.000Z");
    insertAsset.run("ccccccccccccccccccccc", "event_image", null, "image", "pending", "2099-01-01T00:00:00.000Z");

    const insertVariant = db.prepare(
      "INSERT INTO media_variants (media_id, variant, byte_size, width, height) VALUES (?, ?, ?, ?, ?)",
    );
    insertVariant.run("aaaaaaaaaaaaaaaaaaaaa", "full", 100, 100, 80);
    insertVariant.run("aaaaaaaaaaaaaaaaaaaaa", "view", 80, 80, 64);
    insertVariant.run("bbbbbbbbbbbbbbbbbbbbb", "full", 100, null, null);
    expect(() => insertVariant.run("ccccccccccccccccccccc", "full", 0, 10, 10))
      .toThrow(/media_variants_byte_size_positive/i);
    expect(() => insertVariant.run("bbbbbbbbbbbbbbbbbbbbb", "view", 100, null, null))
      .toThrow(/media_variants_type_mismatch/i);
    expect(() => insertVariant.run("bbbbbbbbbbbbbbbbbbbbb", "preview", 100, null, null))
      .toThrow(/media_variants_type_mismatch/i);
    expect(() => insertVariant.run("bbbbbbbbbbbbbbbbbbbbb", "view", 100, 10, null))
      .toThrow(/media_variants_type_mismatch/i);

    db.prepare("UPDATE media_assets SET state = 'ready' WHERE id IN (?, ?)")
      .run("aaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbb");
    expect(() => db.prepare("UPDATE media_assets SET state = 'ready' WHERE id = ?")
      .run("ccccccccccccccccccccc")).toThrow(/media_assets_ready_variants_invalid/i);
    expect(() => db.prepare("UPDATE media_variants SET byte_size = 101 WHERE media_id = ? AND variant = 'full'")
      .run("aaaaaaaaaaaaaaaaaaaaa")).toThrow(/media_variants_update_invalid/i);
    expect(() => db.prepare("DELETE FROM media_variants WHERE media_id = ? AND variant = 'full'")
      .run("aaaaaaaaaaaaaaaaaaaaa")).toThrow(/media_variants_ready_immutable/i);
    expect(() => db.prepare("UPDATE media_variants SET media_id = ? WHERE media_id = ? AND variant = 'full'")
      .run("ccccccccccccccccccccc", "aaaaaaaaaaaaaaaaaaaaa")).toThrow(/media_variants_update_invalid/i);

    db.prepare("DELETE FROM media_assets WHERE id = ?").run("aaaaaaaaaaaaaaaaaaaaa");
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_variants WHERE media_id = ?")
      .get("aaaaaaaaaaaaaaaaaaaaa")).toEqual({ n: 0 });
  });

  it("enforces the relational site-config singleton and policy bounds", () => {
    const update = (assignment: string) => db.prepare(
      `UPDATE site_config SET ${assignment} WHERE id = 'default'`,
    ).run();

    expect(() => update("id = 'other'")).toThrow(/site_config_singleton_id/i);
    expect(() => update("site_name = '   '")).toThrow(/site_config_site_name_valid/i);
    expect(() => update("feature_events_enabled = 2")).toThrow(/site_config_feature_flags_boolean/i);
    expect(() => update("media_site_logo_max_bytes = 0")).toThrow(/site_config_media_max_bytes_bounds/i);
    expect(() => update("media_class_icon_max_bytes = 16252929")).toThrow(/site_config_media_max_bytes_bounds/i);
    expect(() => update("media_gallery_quota = 101")).toThrow(/site_config_media_quotas_bounds/i);
    expect(() => update("storage_images_per_item = 6")).toThrow(/site_config_storage_images_per_item_bounds/i);
    expect(() => update("absence_max_span_days = 367")).toThrow(/site_config_absence_policy_bounds/i);
    expect(() => update("absence_max_entries_per_user = 21")).toThrow(/site_config_absence_policy_bounds/i);
    expect(() => update("analytics_reference_duration_minutes = 0")).toThrow(/site_config_analytics_reference_duration_positive/i);
    expect(() => update("analytics_kills_weight = -0.1")).toThrow(/site_config_analytics_weights_valid/i);
    expect(() => update(
      "analytics_kills_weight = 0, analytics_towers_weight = 0, analytics_base_hp_weight = 0, analytics_credits_weight = 0, analytics_distance_weight = 0",
    )).toThrow(/site_config_analytics_weights_valid/i);
  });

  it("keeps media ownership nullable, links many-to-many, and cascades asset children", () => {
    insertReadyAsset(db, "aaaaaaaaaaaaaaaaaaaaa", "event_image", "image", USER_2_ID);
    db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES ('event-1', 'other', 'Event', '2026-08-08T19:00:00.000Z', ?)").run(USER_1_ID);
    db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_frequency, recurrence_interval, created_by)
       VALUES ('template-1', 'other', 'Template', '19:00', 'daily', 1, ?)`,
    ).run(USER_1_ID);
    const insertLink = db.prepare(
      "INSERT INTO media_links (media_id, entity_type, entity_id, slot, sort_order) VALUES (?, ?, ?, ?, ?)",
    );
    insertLink.run("aaaaaaaaaaaaaaaaaaaaa", "event", "event-1", "attachment", 0);
    insertLink.run("aaaaaaaaaaaaaaaaaaaaa", "recurring_template", "template-1", "attachment", 0);

    db.prepare("DELETE FROM users WHERE id = ?").run(USER_2_ID);
    expect(db.prepare("SELECT owner_user_id FROM media_assets WHERE id = 'aaaaaaaaaaaaaaaaaaaaa'").get())
      .toEqual({ owner_user_id: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_links WHERE media_id = 'aaaaaaaaaaaaaaaaaaaaa'").get())
      .toEqual({ n: 2 });

    db.prepare("DELETE FROM media_assets WHERE id = 'aaaaaaaaaaaaaaaaaaaaa'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_variants").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_links").get()).toEqual({ n: 0 });
  });

  it("rejects invalid media link slots, singular ordering, and duplicate placements", () => {
    insertReadyAsset(db, "aaaaaaaaaaaaaaaaaaaaa", "gallery_image", "image");
    insertReadyAsset(db, "bbbbbbbbbbbbbbbbbbbbb", "gallery_image", "image");
    insertReadyAsset(db, "ccccccccccccccccccccc", "member_avatar", "image");
    db.prepare("INSERT INTO gallery_items (id, type, uploaded_by) VALUES ('gallery-1', 'image', ?)").run(USER_1_ID);
    db.prepare("INSERT INTO member_profiles (user_id) VALUES (?)").run(USER_1_ID);

    const insertLink = db.prepare(
      "INSERT INTO media_links (media_id, entity_type, entity_id, slot, sort_order) VALUES (?, ?, ?, ?, ?)",
    );
    insertLink.run("aaaaaaaaaaaaaaaaaaaaa", "gallery_item", "gallery-1", "image", 0);
    expect(() => insertLink.run("bbbbbbbbbbbbbbbbbbbbb", "gallery_item", "gallery-1", "image", 0))
      .toThrow(/UNIQUE constraint failed/i);
    expect(() => insertLink.run("bbbbbbbbbbbbbbbbbbbbb", "gallery_item", "gallery-1", "image", 1))
      .toThrow(/media_links_gallery_sort_zero/i);
    expect(() => insertLink.run("bbbbbbbbbbbbbbbbbbbbb", "gallery_item", "gallery-1", "body", 0))
      .toThrow(/media_links_asset_invalid/i);
    expect(() => insertLink.run("ccccccccccccccccccccc", "member_profile", USER_1_ID, "avatar", 1))
      .toThrow(/media_links_singular_sort_zero/i);
  });

  it("normalizes external profile videos and keeps gallery URLs video-only", () => {
    db.prepare("INSERT INTO member_profiles (user_id) VALUES (?)").run(USER_1_ID);
    const insertVideo = db.prepare(
      "INSERT INTO member_profile_videos (user_id, url, sort_order) VALUES (?, ?, ?)",
    );
    insertVideo.run(USER_1_ID, "https://video.example/one", 0);
    insertVideo.run(USER_1_ID, "https://video.example/two", 1);
    expect(() => insertVideo.run(USER_1_ID, "https://video.example/three", 1)).toThrow(/UNIQUE constraint failed/i);
    expect(() => insertVideo.run(USER_1_ID, "https://video.example/negative", -1))
      .toThrow(/member_profile_videos_sort_nonnegative/i);

    db.prepare("INSERT INTO gallery_items (id, type, uploaded_by) VALUES ('gallery-image', 'image', ?)").run(USER_1_ID);
    db.prepare("INSERT INTO gallery_items (id, type, url, uploaded_by) VALUES ('gallery-video', 'video', 'https://video.example/watch', ?)").run(USER_1_ID);
    expect(() => db.prepare(
      "INSERT INTO gallery_items (id, type, url, uploaded_by) VALUES ('bad-image', 'image', 'r2/key.webp', ?)",
    ).run(USER_1_ID)).toThrow(/gallery_items_source_consistent/i);
    expect(() => db.prepare(
      "INSERT INTO gallery_items (id, type, uploaded_by) VALUES ('bad-video', 'video', ?)",
    ).run(USER_1_ID)).toThrow(/gallery_items_source_consistent/i);
  });

  it("blocks item deletion once ledger rows exist", () => {
    db.prepare("INSERT INTO storages (id, name) VALUES (?, ?)").run("storage-1", "Main");
    db.prepare("INSERT INTO storage_items (id, storage_id, name, quantity) VALUES (?, ?, ?, ?)")
      .run("item-1", "storage-1", "Potion", 1);
    db.prepare("INSERT INTO storage_transactions (id, item_id, type, quantity_delta, actor_id) VALUES (?, ?, ?, ?, ?)")
      .run("tx-1", "item-1", "intake", 1, USER_1_ID);

    expect(() => db.prepare("DELETE FROM storage_items WHERE id = ?").run("item-1"))
      .toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("enforces storage batch identity, ledger shape, and same-storage categories", () => {
    const batchId = `storage-batch-${"a".repeat(64)}`;
    db.prepare("INSERT INTO storages (id, name) VALUES (?, ?), (?, ?)")
      .run("storage-a", "A", "storage-b", "B");
    db.prepare("INSERT INTO storage_categories (id, storage_id, name) VALUES (?, ?, ?)")
      .run("category-a", "storage-a", "Category A");

    expect(() => db.prepare(
      "INSERT INTO storage_items (id, storage_id, category_id, name) VALUES (?, ?, ?, ?)",
    ).run("cross-storage-item", "storage-b", "category-a", "Invalid"))
      .toThrow(/FOREIGN KEY constraint failed/i);

    db.prepare("INSERT INTO storage_items (id, storage_id, category_id, name, quantity) VALUES (?, ?, ?, ?, ?)")
      .run("item-a", "storage-a", "category-a", "Item A", 2);
    db.prepare("INSERT INTO storage_items (id, storage_id, name, quantity) VALUES (?, ?, ?, ?)")
      .run("item-b", "storage-a", "Item B", 0);

    expect(() => db.prepare("INSERT INTO storage_batches (id, actor_id) VALUES (?, ?)")
      .run("storage-batch-invalid", USER_1_ID)).toThrow(/storage_batches_id_valid/i);
    expect(() => db.prepare("INSERT INTO storage_batches (id, actor_id) VALUES (?, ?)")
      .run(`storage-batch-${"A".repeat(64)}`, USER_1_ID)).toThrow(/storage_batches_id_valid/i);
    db.prepare("INSERT INTO storage_batches (id, actor_id) VALUES (?, ?)")
      .run(batchId, USER_1_ID);

    const insertTransaction = db.prepare(
      `INSERT INTO storage_transactions
        (id, item_id, type, quantity_delta, actor_id, batch_id, batch_position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    expect(() => insertTransaction.run("tx-pair-1", "item-a", "intake", 1, USER_1_ID, batchId, null))
      .toThrow(/storage_transactions_batch_pair_valid/i);
    expect(() => insertTransaction.run("tx-pair-2", "item-a", "intake", 1, USER_1_ID, null, 0))
      .toThrow(/storage_transactions_batch_pair_valid/i);
    expect(() => insertTransaction.run("tx-actor", "item-a", "intake", 1, USER_2_ID, batchId, 0))
      .toThrow(/FOREIGN KEY constraint failed/i);

    const insertSingle = db.prepare(
      "INSERT INTO storage_transactions (id, item_id, type, quantity_delta, actor_id) VALUES (?, ?, ?, ?, ?)",
    );
    expect(() => insertSingle.run("tx-intake-sign", "item-a", "intake", -1, USER_1_ID))
      .toThrow(/storage_transactions_quantity_sign_valid/i);
    expect(() => insertSingle.run("tx-distribute-sign", "item-a", "distribute", 1, USER_1_ID))
      .toThrow(/storage_transactions_quantity_sign_valid/i);
    expect(() => insertSingle.run("tx-zero", "item-a", "adjust", 0, USER_1_ID))
      .toThrow(/storage_transactions_quantity_nonzero/i);
    insertSingle.run("tx-single", "item-b", "adjust", 1, USER_1_ID);

    insertTransaction.run("tx-batch-0", "item-a", "intake", 2, USER_1_ID, batchId, 0);
    expect(() => insertTransaction.run("tx-duplicate-position", "item-b", "intake", 1, USER_1_ID, batchId, 0))
      .toThrow(/UNIQUE constraint failed/i);
    expect(() => insertTransaction.run("tx-duplicate-item", "item-a", "intake", 1, USER_1_ID, batchId, 1))
      .toThrow(/UNIQUE constraint failed/i);
    expect(() => db.prepare("DELETE FROM storage_batches WHERE id = ?").run(batchId))
      .toThrow(/FOREIGN KEY constraint failed/i);
  });
});
