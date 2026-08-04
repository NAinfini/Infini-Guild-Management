import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterAll, describe, expect, it } from "vitest";
import {
  announcements,
  auditLog,
  errorLog,
  eventAttachments,
  eventParticipants,
  eventPollVotes,
  eventRaffleWinners,
  events,
  inviteLinks,
  memberAbsences,
  memberProfileClasses,
  memberProfileImages,
  memberProfiles,
  recurringTemplateAttachments,
  recurringTemplates,
  roles,
  storageTransactions,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  wikiCategories,
} from "../schema";
import { createMigratedDatabase, schemaObjectSql } from "./migration-test-utils";

const migrated = createMigratedDatabase();
afterAll(() => migrated.close());

function tableBlock(table: string): string {
  const block = schemaObjectSql(migrated, "table", table);
  expect(block, `missing ${table} DDL`).toBeTruthy();
  return block;
}

function checkNames(table: SQLiteTable): string[] {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

describe("core schema Drizzle/migrated-schema parity", () => {
  it("keeps every runtime CHECK aligned with its named Drizzle check", () => {
    const expected: Array<readonly [SQLiteTable, string, readonly string[], readonly string[]]> = [
      [roles, "roles", ["roles_level_positive"], ["CHECK (level >= 1)"]],
      [memberProfiles, "member_profiles", ["member_profiles_power_nonnegative"], []],
      [events, "events", ["events_type_valid", "events_capacity_positive", "events_winner_count_positive"], []],
      [recurringTemplates, "recurring_templates", ["recurring_templates_type_valid", "recurring_templates_capacity_positive"], []],
      [announcements, "announcements", ["announcements_status_valid"], []],
      [warHistory, "war_history", ["war_history_result_valid", "war_history_duration_positive"], []],
      [warTeams, "war_teams", ["war_teams_exactly_one_parent"], []],
      [warPoolMembers, "war_pool_members", ["war_pool_members_exactly_one_parent"], []],
      [inviteLinks, "invite_links", ["invite_links_max_uses_positive", "invite_links_used_count_valid"], ["CHECK (max_uses > 0)", "CHECK (used_count >= 0 AND used_count <= max_uses)"]],
      [memberAbsences, "member_absences", ["member_absences_date_range_valid"], []],
      [storageTransactions, "storage_transactions", ["storage_transactions_type_valid"], []],
    ];

    for (const [table, tableName, names, legacyEquivalentChecks] of expected) {
      expect(checkNames(table)).toEqual(expect.arrayContaining([...names]));
      const ddl = tableBlock(tableName);
      if (legacyEquivalentChecks.length > 0) {
        for (const expression of legacyEquivalentChecks) expect(ddl).toContain(expression);
      } else {
        for (const name of names) expect(ddl).toContain(`CONSTRAINT ${name} CHECK`);
      }
    }
  });

  it("removes legacy JSON/list columns and keeps ordered relations in both schema sources", () => {
    expect(getTableConfig(memberProfiles).columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["classes", "images", "vacation_start", "vacation_end"]),
    );
    expect(getTableConfig(events).columns.map((column) => column.name)).not.toContain("attachments");
    expect(getTableConfig(recurringTemplates).columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["attachments", "timezone_offset_minutes"]),
    );
    expect(tableBlock("member_profiles")).not.toMatch(/\b(classes|images|vacation_start|vacation_end)\b/);
    expect(tableBlock("events")).not.toMatch(/\battachments\b/);
    expect(tableBlock("recurring_templates")).not.toMatch(/\b(attachments|timezone_offset_minutes)\b/);

    const relations: Array<readonly [SQLiteTable, string, string]> = [
      [memberProfileClasses, "ux_member_profile_classes_user_sort", "idx_member_profile_classes_class_user"],
      [memberProfileImages, "ux_member_profile_images_user_sort", "idx_member_profile_images_media_user"],
      [eventAttachments, "ux_event_attachments_event_sort", "idx_event_attachments_media_event"],
      [recurringTemplateAttachments, "ux_recurring_template_attachments_template_sort", "idx_recurring_template_attachments_media_template"],
    ];
    for (const [table, uniqueName, lookupName] of relations) {
      const indexes = getTableConfig(table).indexes;
      expect(indexes.find((index) => index.config.name === uniqueName)?.config.unique).toBe(true);
      expect(indexes.map((index) => index.config.name)).toContain(lookupName);
      expect(schemaObjectSql(migrated, "index", uniqueName)).toBeTruthy();
      expect(schemaObjectSql(migrated, "index", lookupName)).toBeTruthy();
    }
  });

  it("keeps the missing relationship foreign keys in both schema sources", () => {
    const expectedForeignKeyCounts: Array<readonly [SQLiteTable, number]> = [
      [eventParticipants, 2],
      [eventPollVotes, 4],
      [eventRaffleWinners, 2],
      [warTeamMembers, 2],
      [warPoolMembers, 3],
      [wikiCategories, 1],
    ];

    for (const [table, count] of expectedForeignKeyCounts) {
      expect(getTableConfig(table).foreignKeys).toHaveLength(count);
    }

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
  });

  it("protects storage ledger rows from item cascade deletion", () => {
    const fk = getTableConfig(storageTransactions).foreignKeys.find((foreignKey) =>
      foreignKey.reference().columns.some((column) => column.name === "item_id"),
    );
    expect(fk?.onDelete).toBe("restrict");
    expect(tableBlock("storage_transactions")).toContain(
      "item_id TEXT NOT NULL REFERENCES storage_items(id) ON DELETE RESTRICT",
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
      ]],
    ];

    for (const [table, names] of expected) {
      expect(getTableConfig(table).indexes.map((index) => index.config.name)).toEqual(
        expect.arrayContaining([...names]),
      );
      for (const name of names) expect(schemaObjectSql(migrated, "index", name)).toBeTruthy();
    }
    expect(getTableConfig(auditLog).indexes.map((index) => index.config.name)).not.toContain("idx_audit_log_actor_id");
    expect(schemaObjectSql(migrated, "index", "idx_audit_log_actor_id")).toBe("");
    expect(schemaObjectSql(migrated, "index", "idx_error_log_source")).toBe("");
  });
});
