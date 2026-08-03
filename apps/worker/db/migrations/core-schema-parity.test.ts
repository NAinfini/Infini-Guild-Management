import { readFileSync } from "node:fs";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  announcements,
  auditLog,
  errorLog,
  eventParticipants,
  eventPollVotes,
  eventRaffleWinners,
  events,
  inviteLinks,
  memberAbsences,
  memberProfiles,
  recurringTemplates,
  roles,
  storageTransactions,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  wikiCategories,
} from "../schema";

const schemaSql = readFileSync("apps/worker/db/migrations/0000_core_schema.sql", "utf8");

function tableBlock(table: string): string {
  const block = schemaSql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
  expect(block, `missing ${table} DDL`).toBeTruthy();
  return block!;
}

function checkNames(table: SQLiteTable): string[] {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

describe("core schema Drizzle/baseline parity", () => {
  it("keeps every baseline CHECK represented by a named Drizzle check", () => {
    const expected: Array<readonly [SQLiteTable, readonly string[]]> = [
      [roles, ["roles_level_positive"]],
      [memberProfiles, ["member_profiles_power_nonnegative"]],
      [events, ["events_type_valid", "events_capacity_positive", "events_winner_count_positive"]],
      [recurringTemplates, ["recurring_templates_type_valid", "recurring_templates_capacity_positive"]],
      [announcements, ["announcements_status_valid"]],
      [warHistory, ["war_history_result_valid", "war_history_duration_positive"]],
      [warTeams, ["war_teams_exactly_one_parent"]],
      [warPoolMembers, ["war_pool_members_exactly_one_parent"]],
      [inviteLinks, ["invite_links_max_uses_positive", "invite_links_used_count_valid"]],
      [memberAbsences, ["member_absences_date_range_valid"]],
      [storageTransactions, ["storage_transactions_type_valid"]],
    ];

    for (const [table, names] of expected) {
      expect(checkNames(table)).toEqual(expect.arrayContaining([...names]));
      for (const name of names) expect(schemaSql).toContain(`CONSTRAINT ${name} CHECK`);
    }
  });

  it("keeps legacy recurring timezone_offset_minutes in both schema sources", () => {
    expect(getTableConfig(recurringTemplates).columns.map((column) => column.name)).toContain("timezone_offset_minutes");
    expect(tableBlock("recurring_templates")).toContain("timezone_offset_minutes INTEGER NOT NULL DEFAULT 0");
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

    expect(tableBlock("event_participants")).toMatch(/event_id TEXT NOT NULL REFERENCES events\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_participants")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_poll_votes")).toContain("FOREIGN KEY (event_id, option_id) REFERENCES event_poll_options(event_id, id) ON DELETE CASCADE");
    expect(tableBlock("event_poll_votes")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_raffle_winners")).toMatch(/event_id TEXT NOT NULL REFERENCES events\(id\) ON DELETE CASCADE/);
    expect(tableBlock("event_raffle_winners")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_team_members")).toMatch(/war_team_id TEXT NOT NULL REFERENCES war_teams\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_team_members")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_pool_members")).toMatch(/war_history_id TEXT REFERENCES war_history\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_pool_members")).toMatch(/event_id TEXT REFERENCES events\(id\) ON DELETE CASCADE/);
    expect(tableBlock("war_pool_members")).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(tableBlock("wiki_categories")).toMatch(/parent_id TEXT REFERENCES wiki_categories\(id\) ON DELETE SET NULL/);
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
      for (const name of names) expect(schemaSql).toContain(`CREATE INDEX IF NOT EXISTS ${name}`);
    }
    expect(getTableConfig(auditLog).indexes.map((index) => index.config.name)).not.toContain("idx_audit_log_actor_id");
    expect(schemaSql).not.toContain("CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id");
    expect(schemaSql).not.toContain("CREATE INDEX IF NOT EXISTS idx_error_log_source ON");
  });
});
