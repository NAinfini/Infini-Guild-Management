import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migration-test-utils";

describe("core schema integrity constraints", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run("user-1", "user-one", "member");
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run("user-2", "user-two", "member");
  });

  afterEach(() => db.close());

  it("rejects participant, raffle, team, pool, and category orphan rows", () => {
    expect(() => db.prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)").run("p-1", "missing", "user-1"))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO event_raffle_winners (id, event_id, user_id) VALUES (?, ?, ?)").run("r-1", "missing", "user-1"))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO war_team_members (id, war_team_id, user_id) VALUES (?, ?, ?)").run("m-1", "missing", "user-1"))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO war_pool_members (id, event_id, user_id) VALUES (?, ?, ?)").run("pool-1", "missing", "user-1"))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.prepare("INSERT INTO wiki_categories (id, name, slug, parent_id) VALUES (?, ?, ?, ?)").run("child", "Child", "child", "missing"))
      .toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a poll vote whose option belongs to a different event", () => {
    const insertEvent = db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'poll', ?, ?, ?)");
    insertEvent.run("event-1", "One", "2026-08-01T00:00:00.000Z", "user-1");
    insertEvent.run("event-2", "Two", "2026-08-01T00:00:00.000Z", "user-1");
    db.prepare("INSERT INTO event_poll_options (id, event_id, label) VALUES (?, ?, ?)").run("option-1", "event-1", "A");

    expect(() => db.prepare(
      "INSERT INTO event_poll_votes (id, event_id, option_id, user_id) VALUES (?, ?, ?, ?)",
    ).run("vote-1", "event-2", "option-1", "user-2")).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("requires exactly one parent for active and historical war rows", () => {
    db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'guild_war', ?, ?, ?)")
      .run("event-1", "War", "2026-08-01T00:00:00.000Z", "user-1");
    db.prepare("INSERT INTO war_history (id, event_id, war_name, created_by) VALUES (?, ?, ?, ?)")
      .run("history-1", "event-1", "History", "user-1");

    expect(() => db.prepare("INSERT INTO war_teams (id, team_name) VALUES (?, ?)").run("team-none", "None"))
      .toThrow(/war_teams_exactly_one_parent/i);
    expect(() => db.prepare("INSERT INTO war_teams (id, war_history_id, event_id, team_name) VALUES (?, ?, ?, ?)")
      .run("team-both", "history-1", "event-1", "Both")).toThrow(/war_teams_exactly_one_parent/i);
    expect(() => db.prepare("INSERT INTO war_pool_members (id, user_id) VALUES (?, ?)").run("pool-none", "user-1"))
      .toThrow(/war_pool_members_exactly_one_parent/i);
    expect(() => db.prepare("INSERT INTO war_pool_members (id, war_history_id, event_id, user_id) VALUES (?, ?, ?, ?)")
      .run("pool-both", "history-1", "event-1", "user-1")).toThrow(/war_pool_members_exactly_one_parent/i);
  });

  it("rejects inverted absence dates", () => {
    expect(() => db.prepare(
      "INSERT INTO member_absences (id, user_id, start_date, end_date) VALUES (?, ?, ?, ?)",
    ).run("absence-1", "user-1", "2026-08-10", "2026-08-01")).toThrow(/member_absences_date_range_valid/i);
  });

  it("rejects gallery and poll values outside their static enums", () => {
    db.prepare("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'poll', ?, ?, ?)")
      .run("event-enum", "Enum poll", "2026-08-01T00:00:00.000Z", "user-1");

    expect(() => db.prepare(
      "INSERT INTO event_polls (event_id, results_visibility) VALUES (?, ?)",
    ).run("event-enum", "admin_only")).toThrow(/CHECK constraint failed/i);
    expect(() => db.prepare(
      "INSERT INTO gallery_items (id, type, url, uploaded_by) VALUES (?, ?, ?, ?)",
    ).run("gallery-enum", "audio", "media/audio", "user-1")).toThrow(/CHECK constraint failed/i);
  });

  it("blocks item deletion once ledger rows exist", () => {
    db.prepare("INSERT INTO storages (id, name) VALUES (?, ?)").run("storage-1", "Main");
    db.prepare("INSERT INTO storage_items (id, storage_id, name, quantity) VALUES (?, ?, ?, ?)")
      .run("item-1", "storage-1", "Potion", 1);
    db.prepare("INSERT INTO storage_transactions (id, item_id, type, quantity_delta, actor_id) VALUES (?, ?, ?, ?, ?)")
      .run("tx-1", "item-1", "intake", 1, "user-1");

    expect(() => db.prepare("DELETE FROM storage_items WHERE id = ?").run("item-1"))
      .toThrow(/FOREIGN KEY constraint failed/i);
  });
});
