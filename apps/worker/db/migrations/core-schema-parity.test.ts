import { getTableConfig, SQLiteSyncDialect, type SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  MEDIA_CONTRACT,
  MEDIA_ENTITY_TYPES,
  MEDIA_PURPOSES,
  MEDIA_SLOTS,
  MEDIA_TYPES,
  MEDIA_VARIANTS,
  type MediaLinkTarget,
  type MediaPurpose,
  type MediaType,
} from "@guild/shared/constants/media";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@guild/shared/constants/audit";
import { PERMISSIONS } from "@guild/shared/constants/roles";
import { afterAll, describe, expect, it } from "vitest";
import {
  announcements,
  auditLog,
  errorLog,
  eventParticipants,
  eventPollOptions,
  eventPolls,
  eventPollVotes,
  eventRaffleWinners,
  events,
  galleryItems,
  inviteLinks,
  loginFailures,
  mediaAssets,
  mediaLinks,
  mediaVariants,
  memberAbsences,
  memberAvailabilityWindows,
  memberBadges,
  memberProfileClasses,
  memberProfiles,
  memberProfileVideos,
  recurringTemplateWeekdays,
  recurringTemplates,
  rolePermissions,
  roles,
  sessions,
  siteConfig,
  storageBatches,
  storageCategories,
  storageItems,
  storageTransactions,
  systemTestArtifacts,
  systemTestRuns,
  users,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  wikiCategories,
  wikiArticles,
  wikiRevisions,
} from "../schema";
import { createMigratedDatabase, migrationFiles, schemaObjectSql } from "./migration-test-utils";

const coreDb = createMigratedDatabase();
afterAll(() => coreDb.close());

function tableBlock(table: string): string {
  const block = schemaObjectSql(coreDb, "table", table);
  expect(block, `missing ${table} DDL`).toBeTruthy();
  return block;
}

function checkNames(table: SQLiteTable): string[] {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

function checkExpression(table: SQLiteTable, name: string): string {
  const constraint = getTableConfig(table).checks.find((candidate) => candidate.name === name);
  expect(constraint, `missing Drizzle CHECK ${name}`).toBeDefined();
  return new SQLiteSyncDialect().sqlToQuery(constraint!.value).sql.replaceAll('"', "");
}

function drizzleChecksAccept(
  table: SQLiteTable,
  tableName: string,
  names: readonly string[],
  values: Readonly<Record<string, string | number | null>>,
): boolean {
  const columns = Object.keys(values);
  const expressions = names.map((name) => `(${checkExpression(table, name)})`).join(" AND ");
  const row = coreDb.prepare(
    `SELECT (${expressions}) AS accepted FROM (SELECT ${columns.map((column) => `? AS ${column}`).join(", ")}) AS ${tableName}`,
  ).get(...Object.values(values)) as { accepted: number } | undefined;
  return row?.accepted === 1;
}

function migrationAcceptsMediaAsset(purpose: MediaPurpose, mediaType: MediaType): boolean {
  const mediaId = "ParityMediaContract01";
  try {
    coreDb.prepare(
      "INSERT INTO media_assets (id, purpose, original_name, media_type, state, expires_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    ).run(mediaId, purpose, mediaType === "audio" ? "recording.ogg" : null, mediaType, "2099-01-01T00:00:00.000Z");
    return true;
  } catch {
    return false;
  } finally {
    coreDb.prepare("DELETE FROM media_assets WHERE id = ?").run(mediaId);
  }
}

function migrationAcceptsMediaOriginalName(mediaType: MediaType, originalName: string | null): boolean {
  const mediaId = "ParityMediaContract01";
  const purpose = mediaType === "audio" ? "member_audio" : "member_image";
  try {
    coreDb.prepare(
      "INSERT INTO media_assets (id, purpose, original_name, media_type, state, expires_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    ).run(mediaId, purpose, originalName, mediaType, "2099-01-01T00:00:00.000Z");
    return true;
  } catch {
    return false;
  } finally {
    coreDb.prepare("DELETE FROM media_assets WHERE id = ?").run(mediaId);
  }
}

describe("core schema Drizzle/SQL parity", () => {
  it("boots from the ordered production migration sequence", () => {
    expect(migrationFiles).toEqual(["0000_core_schema.sql"]);
  });

  it("keeps every runtime CHECK aligned with its named Drizzle check", () => {
    const expected: Array<readonly [SQLiteTable, string, readonly string[], readonly string[]]> = [
      [roles, "roles", ["roles_level_positive"], ["CHECK (level >= 1)"]],
      [rolePermissions, "role_permissions", ["role_permissions_permission_valid"], []],
      [users, "users", ["users_id_nanoid", "users_is_active_boolean"], []],
      [auditLog, "audit_log", ["audit_log_entity_type_valid", "audit_log_action_valid", "audit_log_detail_object"], []],
      [errorLog, "error_log", ["error_log_source_valid", "error_log_level_valid", "error_log_context_object"], []],
      [memberProfiles, "member_profiles", [
        "member_profiles_power_nonnegative",
        "member_profiles_availability_timezone_valid",
      ], []],
      [memberAvailabilityWindows, "member_availability_windows", [
        "member_availability_windows_weekday_valid",
        "member_availability_windows_start_valid",
        "member_availability_windows_end_valid",
        "member_availability_windows_range_valid",
      ], []],
      [memberProfileVideos, "member_profile_videos", ["member_profile_videos_sort_nonnegative"], []],
      [mediaAssets, "media_assets", [
        "media_assets_id_nanoid",
        "media_assets_purpose_valid",
        "media_assets_media_type_valid",
        "media_assets_state_valid",
        "media_assets_purpose_type_consistent",
        "media_assets_pending_expiry_required",
        "media_assets_expires_at_valid",
        "media_assets_original_name_contract",
      ], []],
      [mediaVariants, "media_variants", [
        "media_variants_variant_valid",
        "media_variants_byte_size_positive",
        "media_variants_dimensions_consistent",
      ], []],
      [mediaLinks, "media_links", [
        "media_links_entity_type_valid",
        "media_links_slot_valid",
        "media_links_sort_nonnegative",
        "media_links_entity_slot_consistent",
        "media_links_singular_sort_zero",
        "media_links_gallery_sort_zero",
      ], []],
      [events, "events", [
        "events_type_valid",
        "events_capacity_positive",
        "events_winner_count_positive",
        "events_boolean_flags_valid",
        "events_series_instance_pair",
        "events_times_valid",
        "events_instance_date_valid",
      ], []],
      [recurringTemplates, "recurring_templates", [
        "recurring_templates_type_valid",
        "recurring_templates_capacity_positive",
        "recurring_templates_start_time_valid",
        "recurring_templates_duration_nonnegative",
        "recurring_templates_visibility_offset_nonnegative",
        "recurring_templates_generation_count_nonnegative",
        "recurring_templates_boolean_flags_valid",
        "recurring_templates_recurrence_valid",
        "recurring_templates_recurrence_end_valid",
        "recurring_templates_last_generated_date_valid",
      ], []],
      [recurringTemplateWeekdays, "recurring_template_weekdays", [
        "recurring_template_weekdays_weekday_valid",
      ], []],
      [announcements, "announcements", ["announcements_status_valid", "announcements_pinned_boolean", "announcements_times_valid", "announcements_body_json_object"], []],
      [warHistory, "war_history", ["war_history_result_valid", "war_history_duration_positive", "war_history_stats_nonnegative"], []],
      [warTeams, "war_teams", ["war_teams_exactly_one_parent", "war_teams_sort_nonnegative", "war_teams_is_locked_boolean"], []],
      [warTeamMembers, "war_team_members", ["war_team_members_sort_nonnegative", "war_team_members_stats_nonnegative"], []],
      [warPoolMembers, "war_pool_members", ["war_pool_members_exactly_one_parent"], []],
      [inviteLinks, "invite_links", ["invite_links_max_uses_positive", "invite_links_used_count_valid", "invite_links_times_valid"], []],
      [loginFailures, "login_failures", ["login_failures_fail_count_nonnegative", "login_failures_locked_until_valid"], []],
      [sessions, "sessions", ["sessions_expires_at_valid"], []],
      [memberAbsences, "member_absences", ["member_absences_dates_valid", "member_absences_date_range_valid"], []],
      [memberBadges, "member_badges", ["member_badges_sort_nonnegative"], []],
      [storageItems, "storage_items", ["storage_items_quantity_nonnegative", "storage_items_boolean_flags_valid"], []],
      [storageBatches, "storage_batches", ["storage_batches_id_valid"], []],
      [storageTransactions, "storage_transactions", [
        "storage_transactions_type_valid",
        "storage_transactions_quantity_nonzero",
        "storage_transactions_quantity_sign_valid",
        "storage_transactions_batch_pair_valid",
      ], []],
      [galleryItems, "gallery_items", ["gallery_items_type_valid", "gallery_items_source_consistent"], []],
      [eventPolls, "event_polls", ["event_polls_results_visibility_valid", "event_polls_show_voter_names_boolean"], []],
      [eventPollOptions, "event_poll_options", ["event_poll_options_sort_nonnegative"], []],
      [systemTestRuns, "system_test_runs", ["system_test_runs_status_valid", "system_test_runs_active_requests_nonnegative", "system_test_runs_cleanup_attempts_nonnegative"], []],
      [systemTestArtifacts, "system_test_artifacts", ["system_test_artifacts_artifact_type_valid"], []],
      [wikiCategories, "wiki_categories", ["wiki_categories_sort_nonnegative"], []],
      [wikiArticles, "wiki_articles", ["wiki_articles_body_json_object", "wiki_articles_sort_nonnegative", "wiki_articles_pinned_boolean", "wiki_articles_archived_at_valid"], []],
      [wikiRevisions, "wiki_revisions", ["wiki_revisions_body_json_object", "wiki_revisions_revision_positive", "wiki_revisions_restored_from_positive"], []],
      [siteConfig, "site_config", [
        "site_config_singleton_id",
        "site_config_site_name_valid",
        "site_config_feature_flags_boolean",
        "site_config_media_max_bytes_bounds",
        "site_config_media_quotas_bounds",
        "site_config_storage_images_per_item_bounds",
        "site_config_absence_policy_bounds",
        "site_config_analytics_reference_duration_positive",
        "site_config_analytics_weights_valid",
      ], []],
    ];

    for (const [table, tableName, names, equivalentSqlChecks] of expected) {
      expect(checkNames(table)).toEqual(expect.arrayContaining([...names]));
      const ddl = tableBlock(tableName);
      if (equivalentSqlChecks.length > 0) {
        for (const expression of equivalentSqlChecks) expect(ddl).toContain(expression);
      } else {
        for (const name of names) expect(ddl).toContain(`CONSTRAINT ${name} CHECK`);
      }
    }
  });

  it("keeps gallery and poll enum CHECK expressions equal to the SQL schema", () => {
    expect(checkExpression(galleryItems, "gallery_items_type_valid"))
      .toContain("gallery_items.type IN ('image', 'video')");
    expect(checkExpression(eventPolls, "event_polls_results_visibility_valid"))
      .toContain("event_polls.results_visibility IN ('always', 'after_vote', 'after_close')");
  });

  it("keeps fixed role, audit, and error enums exact", () => {
    const valuesFromCheck = (tableName: string, constraintName: string): string[] => {
      const ddl = tableBlock(tableName);
      const marker = `CONSTRAINT ${constraintName} CHECK`;
      const start = ddl.indexOf(marker);
      expect(start, `missing ${constraintName}`).toBeGreaterThanOrEqual(0);
      const end = ddl.indexOf("))", start + marker.length);
      expect(end, `unterminated ${constraintName}`).toBeGreaterThan(start);
      const fragment = ddl.slice(start, end + 2);
      return [...fragment.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
    };

    expect(valuesFromCheck("role_permissions", "role_permissions_permission_valid"))
      .toEqual(PERMISSIONS);
    expect(valuesFromCheck("audit_log", "audit_log_entity_type_valid"))
      .toEqual(AUDIT_ENTITY_TYPES);
    expect(valuesFromCheck("audit_log", "audit_log_action_valid"))
      .toEqual(AUDIT_ACTIONS);
    expect(valuesFromCheck("error_log", "error_log_source_valid"))
      .toEqual(["request", "cron", "push", "audit"]);
    expect(valuesFromCheck("error_log", "error_log_level_valid"))
      .toEqual(["error", "warn"]);
  });

  it("uses row-presence permissions and the natural poll-vote identity", () => {
    expect(getTableConfig(rolePermissions).columns.map((column) => column.name))
      .toEqual(["role_id", "permission"]);
    expect(coreDb.prepare("PRAGMA table_info(role_permissions)").all().map((column) => (
      column as { name: string }
    ).name)).toEqual(["role_id", "permission"]);

    const voteColumns = ["event_id", "option_id", "user_id", "created_at"];
    expect(getTableConfig(eventPollVotes).columns.map((column) => column.name)).toEqual(voteColumns);
    const migratedVoteColumns = coreDb.prepare("PRAGMA table_info(event_poll_votes)").all() as Array<{
      name: string;
      pk: number;
    }>;
    expect(migratedVoteColumns.map((column) => column.name)).toEqual(voteColumns);
    expect(migratedVoteColumns.filter((column) => column.pk > 0).map((column) => column.name))
      .toEqual(["event_id", "option_id", "user_id"]);
  });

  it("keeps canonical media enums exact in Drizzle and SQL checks", () => {
    const expected: Array<readonly [SQLiteTable, string, string, readonly string[]]> = [
      [mediaAssets, "media_assets", "media_assets_purpose_valid", MEDIA_PURPOSES],
      [mediaAssets, "media_assets", "media_assets_media_type_valid", MEDIA_TYPES],
      [mediaVariants, "media_variants", "media_variants_variant_valid", MEDIA_VARIANTS],
      [mediaLinks, "media_links", "media_links_entity_type_valid", MEDIA_ENTITY_TYPES],
      [mediaLinks, "media_links", "media_links_slot_valid", MEDIA_SLOTS],
    ];

    for (const [table, tableName, checkName, values] of expected) {
      const inList = `('${values.join("', '")}')`;
      expect(checkExpression(table, checkName)).toContain(` IN ${inList}`);
      expect(tableBlock(tableName)).toContain(` IN ${inList}`);
    }
  });

  it("keeps D1 media purpose/type and link-target rules aligned with the shared contract", () => {
    for (const purpose of MEDIA_PURPOSES) {
      const expectedType = MEDIA_CONTRACT.find((entry) => entry.purpose === purpose)!.mediaType;
      for (const mediaType of MEDIA_TYPES) {
        const expected = mediaType === expectedType;
        expect(drizzleChecksAccept(mediaAssets, "media_assets", [
          "media_assets_purpose_type_consistent",
        ], { purpose, media_type: mediaType }), `Drizzle media type for ${purpose}`).toBe(expected);
        expect(migrationAcceptsMediaAsset(purpose, mediaType), `D1 media type for ${purpose}`).toBe(expected);
      }
    }

    const targets = MEDIA_CONTRACT.flatMap<MediaLinkTarget>((entry) => entry.targets);
    for (const entityType of MEDIA_ENTITY_TYPES) {
      for (const slot of MEDIA_SLOTS) {
        const target = targets.find((candidate) => (
          candidate.entityType === entityType && candidate.slot === slot
        ));
        for (const sortOrder of [0, 1]) {
          const expected = target !== undefined && (!target.singular || sortOrder === 0);
          const values = { entity_type: entityType, slot, sort_order: sortOrder };
          expect(drizzleChecksAccept(mediaLinks, "media_links", [
            "media_links_entity_slot_consistent",
            "media_links_singular_sort_zero",
            "media_links_gallery_sort_zero",
          ], values), `Drizzle media link ${entityType}/${slot}/${sortOrder}`).toBe(expected);
        }
      }
    }

    const trigger = schemaObjectSql(coreDb, "trigger", "media_links_validate_insert");
    for (const definition of MEDIA_CONTRACT) {
      for (const target of definition.targets) {
        expect(trigger).toContain(
          `asset.purpose = '${definition.purpose}' AND NEW.entity_type = '${target.entityType}' AND NEW.slot = '${target.slot}'`,
        );
      }
    }
  });

  it("keeps the media original-name contract equal in Drizzle and D1", () => {
    const cases = [
      { mediaType: "image", originalName: null, accepted: true },
      { mediaType: "image", originalName: "image.webp", accepted: false },
      { mediaType: "audio", originalName: "recording.ogg", accepted: true },
      { mediaType: "audio", originalName: "   ", accepted: false },
      { mediaType: "audio", originalName: null, accepted: false },
      { mediaType: "audio", originalName: "a".repeat(256), accepted: false },
    ] as const;

    for (const testCase of cases) {
      const values = { media_type: testCase.mediaType, original_name: testCase.originalName };
      expect(drizzleChecksAccept(mediaAssets, "media_assets", [
        "media_assets_original_name_contract",
      ], values)).toBe(testCase.accepted);
      expect(migrationAcceptsMediaOriginalName(testCase.mediaType, testCase.originalName))
        .toBe(testCase.accepted);
    }
  });

  it("keeps denormalized JSON/list columns out of ordered relations", () => {
    expect(getTableConfig(memberProfiles).columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["classes", "images", "vacation_start", "vacation_end", "avatar_key", "audio_key", "video_urls", "availability"]),
    );
    expect(getTableConfig(events).columns.map((column) => column.name)).not.toContain("attachments");
    expect(getTableConfig(recurringTemplates).columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["attachments", "timezone_offset_minutes", "recurrence_rule"]),
    );
    expect(tableBlock("member_profiles")).not.toMatch(/\b(classes|images|vacation_start|vacation_end|avatar_key|audio_key|video_urls|availability)\b/);
    expect(tableBlock("events")).not.toMatch(/\battachments\b/);
    expect(tableBlock("recurring_templates")).not.toMatch(/\b(attachments|timezone_offset_minutes|recurrence_rule)\b/);

    const classIndexes = getTableConfig(memberProfileClasses).indexes;
    expect(classIndexes.find((index) => index.config.name === "ux_member_profile_classes_user_sort")?.config.unique).toBe(true);
    expect(classIndexes.map((index) => index.config.name)).toContain("idx_member_profile_classes_class_user");
    expect(schemaObjectSql(coreDb, "index", "ux_member_profile_classes_user_sort")).toBeTruthy();
    expect(schemaObjectSql(coreDb, "index", "idx_member_profile_classes_class_user")).toBeTruthy();

    expect(getTableConfig(memberProfileVideos).indexes.find(
      (index) => index.config.name === "ux_member_profile_videos_user_sort",
    )?.config.unique).toBe(true);
    expect(schemaObjectSql(coreDb, "index", "ux_member_profile_videos_user_sort")).toBeTruthy();
  });

  it("keeps fresh normalized profile, media, and recurrence tables exact across both schema sources", () => {
    const expectedColumns: Array<readonly [SQLiteTable, string, readonly string[]]> = [
      [memberProfiles, "member_profiles", ["user_id", "power", "title_html", "bio", "availability_timezone", "notes", "created_at", "updated_at"]],
      [memberAvailabilityWindows, "member_availability_windows", ["user_id", "weekday", "start_minute", "end_minute"]],
      [mediaAssets, "media_assets", ["id", "owner_user_id", "purpose", "original_name", "media_type", "state", "expires_at", "created_at"]],
      [mediaVariants, "media_variants", ["media_id", "variant", "byte_size", "width", "height"]],
      [mediaLinks, "media_links", ["media_id", "entity_type", "entity_id", "slot", "sort_order"]],
      [memberProfileVideos, "member_profile_videos", ["user_id", "url", "sort_order"]],
      [recurringTemplates, "recurring_templates", [
        "id", "type", "title", "description", "start_time", "duration_minutes", "capacity",
        "recurrence_frequency", "recurrence_interval", "recurrence_day_of_month",
        "recurrence_end_after", "recurrence_end_at", "visibility_offset_minutes", "auto_archive",
        "paused", "created_by", "last_generated_date", "generation_count", "created_at", "updated_at",
      ]],
      [recurringTemplateWeekdays, "recurring_template_weekdays", ["template_id", "weekday"]],
    ];

    for (const [table, tableName, columns] of expectedColumns) {
      expect(getTableConfig(table).columns.map((column) => column.name)).toEqual(columns);
      expect(coreDb.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => (
        column as { name: string }
      ).name)).toEqual(columns);
    }

    expect(getTableConfig(mediaLinks).indexes.find(
      (index) => index.config.name === "ux_media_links_entity_slot_sort",
    )?.config.unique).toBe(true);
    for (const indexName of [
      "idx_media_assets_expiry",
      "idx_media_assets_owner_purpose_state_expiry",
      "ux_media_links_entity_slot_sort",
    ]) {
      expect(schemaObjectSql(coreDb, "index", indexName), indexName).toBeTruthy();
    }

    for (const triggerName of [
      "media_assets_ready_insert_guard",
      "media_variants_validate_insert",
      "media_variants_validate_update",
      "media_variants_ready_delete_guard",
      "media_assets_ready_variants_valid",
      "media_links_validate_insert",
      "media_links_identity_immutable",
      "media_links_claim_asset",
      "media_links_release_asset",
      "member_profiles_delete_media_links",
      "gallery_items_delete_media_links",
      "events_delete_media_links",
      "recurring_templates_delete_media_links",
      "announcements_delete_media_links",
      "wiki_articles_delete_media_links",
      "storage_items_delete_media_links",
      "class_catalog_delete_media_links",
      "site_config_delete_media_links",
      "class_tags_validate_owner_insert",
      "class_tags_validate_owner_update",
      "events_delete_owned_class_tags",
      "recurring_templates_delete_owned_class_tags",
    ]) {
      expect(schemaObjectSql(coreDb, "trigger", triggerName), triggerName).toBeTruthy();
    }

    for (const removedTable of [
      "media_references",
      "media_upload_leases",
      "member_profile_images",
      "event_attachments",
      "recurring_template_attachments",
      "storage_item_images",
      "game_data",
      "onboarding_config",
      "member_onboarding_state",
    ]) {
      expect(schemaObjectSql(coreDb, "table", removedTable), removedTable).toBe("");
    }
  });

  it("keeps fixed guild-war statistics normalized across both schema sources", () => {
    const expectedColumns: Array<readonly [SQLiteTable, string, readonly string[]]> = [
      [warHistory, "war_history", [
        "id", "event_id", "war_name", "enemy_name", "result",
        "own_kills", "own_towers", "own_base_hp", "own_credits", "own_distance",
        "enemy_kills", "enemy_towers", "enemy_base_hp", "enemy_credits", "enemy_distance",
        "duration_minutes", "notes", "created_by", "updated_by", "created_at", "updated_at",
      ]],
      [warTeamMembers, "war_team_members", [
        "id", "war_team_id", "user_id", "role_tag", "sort_order",
        "kills", "deaths", "assists", "damage", "healing", "building_damage", "credits", "damage_taken",
        "note",
      ]],
    ];

    for (const [table, tableName, columns] of expectedColumns) {
      expect(getTableConfig(table).columns.map((column) => column.name)).toEqual(columns);
      expect(coreDb.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => (
        column as { name: string }
      ).name)).toEqual(columns);
    }

    expect(tableBlock("war_history")).not.toMatch(/\b(own_stats|enemy_stats)\b/);
    expect(tableBlock("war_team_members")).not.toMatch(/\bstats\b/);
  });

  it("keeps the singleton site configuration relational across both schema sources", () => {
    const columns = [
      "id", "site_name",
      "feature_announcements_enabled", "feature_events_enabled", "feature_guild_war_enabled",
      "feature_gallery_enabled", "feature_wiki_enabled", "feature_tools_enabled", "feature_storage_enabled",
      "media_site_logo_max_bytes", "media_class_icon_max_bytes", "media_profile_image_max_bytes",
      "media_profile_audio_max_bytes", "media_announcement_image_max_bytes", "media_wiki_image_max_bytes",
      "media_event_image_max_bytes", "media_gallery_image_max_bytes", "media_storage_image_max_bytes",
      "media_profile_quota", "media_announcement_quota", "media_gallery_quota", "media_wiki_quota",
      "storage_images_per_item", "absence_max_span_days", "absence_max_entries_per_user",
      "analytics_reference_duration_minutes", "analytics_kills_weight", "analytics_towers_weight",
      "analytics_base_hp_weight", "analytics_credits_weight", "analytics_distance_weight",
      "created_at", "updated_at",
    ];

    expect(getTableConfig(siteConfig).columns.map((column) => column.name)).toEqual(columns);
    expect(coreDb.prepare("PRAGMA table_info(site_config)").all().map((column) => (
      column as { name: string }
    ).name)).toEqual(columns);
    expect(columns).not.toEqual(expect.arrayContaining([
      "feature_flags_json",
      "media_policy_json",
      "storage_policy_json",
      "absence_policy_json",
      "analytics_settings_json",
    ]));
  });

  it("keeps the missing relationship foreign keys in both schema sources", () => {
    const expectedForeignKeyCounts: Array<readonly [SQLiteTable, number]> = [
      [events, 3],
      [memberAvailabilityWindows, 1],
      [recurringTemplateWeekdays, 1],
      [eventParticipants, 2],
      [eventPollVotes, 2],
      [eventRaffleWinners, 2],
      [warTeamMembers, 2],
      [warPoolMembers, 3],
      [wikiCategories, 1],
      [storageItems, 2],
      [storageBatches, 1],
      [storageTransactions, 4],
    ];

    for (const [table, count] of expectedForeignKeyCounts) {
      expect(getTableConfig(table).foreignKeys).toHaveLength(count);
    }

    expect(tableBlock("events")).toMatch(/series_id TEXT REFERENCES recurring_templates\(id\)/);
    expect(tableBlock("member_availability_windows")).toMatch(/user_id TEXT NOT NULL REFERENCES member_profiles\(user_id\) ON DELETE CASCADE/);
    expect(tableBlock("recurring_template_weekdays")).toMatch(/template_id TEXT NOT NULL REFERENCES recurring_templates\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_participants")).toMatch(/event_id TEXT NOT NULL REFERENCES "?events"?\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_participants")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_poll_votes")).toMatch(/FOREIGN KEY \(event_id, option_id\) REFERENCES "?event_poll_options"?\(event_id, id\) ON DELETE CASCADE/);
    expect(tableBlock("event_poll_votes")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_raffle_winners")).toMatch(/event_id TEXT NOT NULL REFERENCES "?events"?\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_raffle_winners")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_team_members")).toMatch(/war_team_id TEXT NOT NULL REFERENCES "?war_teams"?\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_team_members")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_pool_members")).toMatch(/war_history_id TEXT REFERENCES "?war_history"?\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_pool_members")).toMatch(/event_id TEXT REFERENCES "?events"?\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_pool_members")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("wiki_categories")).toMatch(/parent_id TEXT REFERENCES "?wiki_categories"?\(id\) ON DELETE SET NULL/);
    expect(tableBlock("storage_items")).toMatch(
      /FOREIGN KEY \(storage_id, category_id\)\s+REFERENCES storage_categories\(storage_id, id\) ON DELETE RESTRICT/,
    );
    expect(tableBlock("storage_transactions")).toMatch(
      /FOREIGN KEY \(batch_id, actor_id\)\s+REFERENCES storage_batches\(id, actor_id\) ON DELETE RESTRICT/,
    );
  });

  it("protects storage ledger rows from item cascade deletion", () => {
    const fk = getTableConfig(storageTransactions).foreignKeys.find((foreignKey) =>
      foreignKey.reference().columns.some((column) => column.name === "item_id"),
    );
    expect(fk?.onDelete).toBe("restrict");
    expect(tableBlock("storage_transactions")).toMatch(
      /item_id TEXT NOT NULL REFERENCES "?storage_items"?\(id\) ON DELETE RESTRICT/,
    );
  });

  it("keeps invite role assignment required and delete-restricted", () => {
    const roleForeignKey = getTableConfig(inviteLinks).foreignKeys.find((foreignKey) =>
      foreignKey.reference().columns.some((column) => column.name === "role_id"),
    );
    expect(roleForeignKey?.onDelete).toBe("restrict");
    expect(tableBlock("invite_links")).toMatch(
      /role_id TEXT NOT NULL REFERENCES "?roles"?\(id\) ON DELETE RESTRICT/,
    );
  });

  it("keeps stable-tail indexes aligned across schema sources", () => {
    const expected: Array<readonly [SQLiteTable, readonly string[]]> = [
      [auditLog, [
        "idx_audit_log_created_at",
        "idx_audit_log_entity_actor_created",
        "idx_audit_log_entity_created",
        "idx_audit_log_actor_created",
      ]],
      [errorLog, ["idx_error_log_created_at", "idx_error_log_source_created"]],
      [storageTransactions, [
        "idx_storage_transactions_item",
        "idx_storage_transactions_recipient",
        "idx_storage_transactions_created",
        "idx_storage_transactions_actor",
        "ux_storage_transactions_batch_position",
        "ux_storage_transactions_batch_item",
      ]],
      [storageCategories, ["idx_storage_categories_storage", "ux_storage_categories_storage_id"]],
      [storageBatches, ["ux_storage_batches_id_actor", "idx_storage_batches_actor_created"]],
    ];

    for (const [table, names] of expected) {
      expect(getTableConfig(table).indexes.map((index) => index.config.name)).toEqual(
        expect.arrayContaining([...names]),
      );
      for (const name of names) expect(schemaObjectSql(coreDb, "index", name)).toBeTruthy();
    }
    expect(getTableConfig(auditLog).indexes.map((index) => index.config.name)).not.toContain("idx_audit_log_actor_id");
    expect(schemaObjectSql(coreDb, "index", "idx_audit_log_actor_id")).toBe("");
    expect(schemaObjectSql(coreDb, "index", "idx_error_log_source")).toBe("");
  });
});
