import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { SqlStatement } from "@guild/kernel";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqlitePortalReadModelStore } from "./portal-read-model-store.js";

const NOW = "2099-08-09T12:00:00.000Z";
const WINDOW_END = "2099-08-16T12:00:00.000Z";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  applyAppMigrations(database);
  seed(database);
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqlitePortalReadModelStore(executor) };
}

describe("SqlitePortalReadModelStore", () => {
  it("loads dashboard events in one bounded batch and applies public visibility before hydration", async () => {
    const value = harness();

    const publicView = await value.store.dashboardEvents({
      now: NOW,
      windowEnd: WINDOW_END,
      viewerUserId: "member-1",
      canViewHidden: false,
    });

    expect(publicView.activeEventCount).toBe(1);
    expect(publicView.featuredEvents).toHaveLength(1);
    expect(publicView.upcomingEvents).toHaveLength(0);
    expect(publicView.mySignupEventIds).toEqual(["event-public"]);
    expect(publicView.featuredEvents[0]).toMatchObject({
      aggregate: {
        event: { id: "event-public", title: "Dragon Raid" },
        attachments: ["bbbbbbbbbbbbbbbbbbbbb"],
        classQuotas: [{ tag_id: "tag-dps", class_ids: ["class-warrior"], required: 1 }],
      },
      participantCount: 1,
      participantPreview: [{
        userId: "member-1",
        display_name: "DragonUser",
        roleId: "member",
        classes: ["class-warrior"],
        avatarMediaId: "aaaaaaaaaaaaaaaaaaaaa",
      }],
      quotaSummary: {
        matchedTotal: 1,
        requiredTotal: 1,
        shortfall: 0,
        unassignedCount: 0,
      },
    });
    expect(value.executor.batches).toHaveLength(1);
    expect(value.executor.batches[0]).toHaveLength(6);
    expect(value.executor.statements).toHaveLength(0);
    expect(value.executor.batches[0]![2]!.sql).toContain("preview_rank <= 5");
    expect(value.executor.batches[0]![2]!.sql).toContain("LIMIT 51");
    expect(value.executor.batches[0]![3]!.sql).toContain("LIMIT 201");
    expect(value.executor.batches[0]![4]!.sql).toContain("LIMIT 5001");

    const plan = explain(value.database, value.executor.batches[0]![0]!);
    expect(plan).toMatch(/idx_events_(?:pinned|public)_start/);

    const editorView = await value.store.dashboardEvents({
      now: NOW,
      windowEnd: WINDOW_END,
      viewerUserId: "admin-1",
      canViewHidden: true,
    });
    expect(editorView.activeEventCount).toBe(2);
    expect(editorView.upcomingEvents.map(({ aggregate }) => aggregate.event.id)).toEqual(["event-hidden"]);
  });

  it("keeps exact counts and viewer signup while returning only a five-member preview", async () => {
    const value = harness();
    const insertUser = value.database.prepare(`INSERT INTO users (
      id, display_name, role_id, is_active, revision_token, created_at, updated_at
    ) VALUES (?, ?, 'member', 1, ?, ?, ?)`);
    const insertParticipant = value.database.prepare(
      "INSERT INTO event_participants (id, event_id, user_id, joined_at) VALUES (?, 'event-public', ?, ?)",
    );
    for (let index = 2; index <= 7; index += 1) {
      const userId = `member-${index}`;
      insertUser.run(userId, `Member${index}`, `member-${index}-revision`, NOW, NOW);
      insertParticipant.run(
        `participant-extra-${index}`,
        userId,
        `2099-08-09T12:00:0${index}.000Z`,
      );
    }

    const result = await value.store.dashboardEvents({
      now: NOW,
      windowEnd: WINDOW_END,
      viewerUserId: "member-7",
      canViewHidden: false,
    });
    const event = result.featuredEvents[0]!;

    expect(event.participantCount).toBe(7);
    expect(event.participantPreview.map(({ userId }) => userId)).toEqual([
      "member-1", "member-2", "member-3", "member-4", "member-5",
    ]);
    expect(result.mySignupEventIds).toEqual(["event-public"]);
    expect(event.quotaSummary).toMatchObject({
      matchedTotal: 1,
      shortfall: 0,
      unassignedCount: 6,
    });
  });

  it("preserves exact matching when one participant is eligible for multiple quota slots", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO class_tags (
      id, label, sort_order, owner_kind, owner_id, created_at, updated_at
    ) VALUES ('tag-flex', 'Flexible', 1, NULL, NULL, ?, ?)`)
      .run(NOW, NOW);
    value.database.prepare("INSERT INTO class_tag_members (tag_id, class_id) VALUES ('tag-flex', 'class-warrior')")
      .run();
    value.database.prepare(
      "INSERT INTO event_class_quotas (event_id, tag_id, required) VALUES ('event-public', 'tag-flex', 1)",
    ).run();

    const result = await value.store.dashboardEvents({
      now: NOW,
      windowEnd: WINDOW_END,
      viewerUserId: "member-1",
      canViewHidden: false,
    });

    expect(result.featuredEvents[0]!.quotaSummary).toMatchObject({
      flexible: 1,
      requiredTotal: 2,
      matchedTotal: 1,
      shortfall: 1,
      unassignedCount: 0,
    });
  });

  it("builds recent war MVPs and win rate in one bounded batch", async () => {
    const value = harness();

    const result = await value.store.dashboardWars();

    expect(result.allWarWinRate).toBe(50);
    expect(result.recentWars.map(({ id }) => id)).toEqual(["war-win", "war-loss"]);
    expect(result.recentWarMvps[0]).toEqual([
      expect.objectContaining({ category: "damage", name: "DragonUser", value: 120 }),
      expect.objectContaining({ category: "healing", value: 15 }),
      expect.objectContaining({ category: "damage_taken", value: 40 }),
      expect.objectContaining({ category: "building_damage", value: 30 }),
    ]);
    expect(value.executor.batches).toHaveLength(1);
    expect(value.executor.batches[0]).toHaveLength(3);
    expect(value.executor.batches[0]![2]!.sql).toContain("LIMIT 4001");
    expect(explain(value.database, value.executor.batches[0]![0]!)).toContain("idx_guild_wars_history_created");
  });

  it("searches only public feature-enabled rows with one bounded six-query batch", async () => {
    const value = harness();

    const result = await value.store.search({ query: "dragon", limit: 24, perTypeLimit: 8, now: NOW });

    expect(result.map(({ type }) => type)).toEqual([
      "user", "event", "announcement", "wiki", "gallery", "war",
    ]);
    expect(result.find(({ type }) => type === "user")).toMatchObject({
      roleName: "Member",
      roleLevel: 100,
    });
    expect(value.executor.batches).toHaveLength(1);
    expect(value.executor.batches[0]).toHaveLength(6);
    expect(value.executor.batches[0]!.every((statement) => statement.sql.includes("LIMIT ?"))).toBe(true);
    const searchStatements = value.executor.batches[0]!;
    const indexedOrders = [
      ["ux_users_display_name_nocase", /ORDER BY u\.display_name COLLATE NOCASE, u\.id\s+LIMIT \?/],
      ["idx_events_list_start", /ORDER BY e\.start_at, e\.id\s+LIMIT \?/],
      ["idx_announcements_public", /ORDER BY a\.pinned DESC, a\.updated_at DESC, a\.id DESC\s+LIMIT \?/],
      ["idx_wiki_articles_visibility_updated", /ORDER BY w\.updated_at DESC, w\.id DESC\s+LIMIT \?/],
      ["idx_gallery_items_created", /ORDER BY g\.created_at DESC, g\.id DESC\s+LIMIT \?/],
      ["idx_guild_wars_history_created", /ORDER BY gw\.created_at DESC, gw\.id DESC\s+LIMIT \?/],
    ] as const;
    for (const [position, [index, order]] of indexedOrders.entries()) {
      const statement = searchStatements[position]!;
      const plan = explain(value.database, statement);
      expect(statement.sql).toMatch(order);
      expect(plan).toContain(index);
      expect(plan).not.toMatch(/USE TEMP B-TREE/i);
    }

    const hidden = await value.store.search({ query: "secret", limit: 24, perTypeLimit: 8, now: NOW });
    expect(hidden).toEqual([]);
  });

  it("uses the roster index for the single member-count query", async () => {
    const value = harness();
    expect(await value.store.dashboardMembers()).toEqual({ activeMemberCount: 2, totalMemberCount: 2 });
    expect(value.executor.statements).toHaveLength(1);
    expect(explain(value.database, value.executor.statements[0]!)).toContain("idx_users_roster");
  });
});

function seed(database: DatabaseSync): void {
  const insertUser = database.prepare(`INSERT INTO users (
    id, display_name, role_id, is_active, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, 1, ?, ?, ?)`);
  insertUser.run("admin-1", "Admin", "admin", "admin-revision-token-0001", NOW, NOW);
  insertUser.run("member-1", "DragonUser", "member", "member-revision-token-001", NOW, NOW);
  database.prepare(`INSERT INTO member_profiles (
    user_id, power, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?)`)
    .run("member-1", 1250, "profile-revision-token-01", NOW, NOW);
  database.prepare(`INSERT INTO class_catalog (
    id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, 'vector', ?, 0, ?, ?)`)
    .run("class-warrior", "Warrior", "red", "swords", NOW, NOW);
  database.prepare("INSERT INTO member_profile_classes (user_id, class_id, sort_order) VALUES (?, ?, 0)")
    .run("member-1", "class-warrior");
  database.prepare(`INSERT INTO class_tags (
    id, label, sort_order, owner_kind, owner_id, created_at, updated_at
  ) VALUES (?, ?, 0, NULL, NULL, ?, ?)`)
    .run("tag-dps", "DPS", NOW, NOW);
  database.prepare("INSERT INTO class_tag_members (tag_id, class_id) VALUES (?, ?)")
    .run("tag-dps", "class-warrior");

  const insertEvent = database.prepare(`INSERT INTO events (
    id, type, title, description, start_at, end_at, pinned, visible_at,
    created_by, created_at, updated_at
  ) VALUES (?, 'weekly_mission', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertEvent.run(
    "event-public", "Dragon Raid", "Public dragon hunt",
    "2099-08-10T12:00:00.000Z", "2099-08-10T13:00:00.000Z", 1, null,
    "admin-1", NOW, NOW,
  );
  insertEvent.run(
    "event-hidden", "Secret Council", "Hidden plan",
    "2099-08-11T12:00:00.000Z", "2099-08-11T13:00:00.000Z", 0, "2099-08-10T12:00:00.000Z",
    "admin-1", NOW, NOW,
  );
  database.prepare(`INSERT INTO events (
    id, type, title, description, start_at, end_at, pinned, visible_at,
    created_by, created_at, updated_at
  ) VALUES (?, 'guild_war', ?, NULL, ?, ?, 0, NULL, ?, ?, ?)`)
    .run(
      "event-war", "Archived Dragon War", "2099-08-08T10:00:00.000Z",
      "2099-08-08T11:00:00.000Z", "admin-1", "2026-08-08T10:00:00.000Z", NOW,
    );
  const insertParticipant = database.prepare(
    "INSERT INTO event_participants (id, event_id, user_id, joined_at) VALUES (?, ?, ?, ?)",
  );
  insertParticipant.run("participant-public", "event-public", "member-1", NOW);
  insertParticipant.run("participant-hidden", "event-hidden", "member-1", NOW);
  insertParticipant.run("participant-war", "event-war", "member-1", "2026-08-08T09:00:00.000Z");
  database.prepare("INSERT INTO event_class_quotas (event_id, tag_id, required) VALUES (?, ?, 1)")
    .run("event-public", "tag-dps");

  const insertMedia = database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, original_name, expires_at,
    delete_claim_token, delete_claim_until, created_at, updated_at
  ) VALUES (?, ?, ?, 'image', 'attached', NULL, NULL, NULL, NULL, ?, ?)`);
  insertMedia.run("aaaaaaaaaaaaaaaaaaaaa", "member-1", "member_avatar", NOW, NOW);
  insertMedia.run("bbbbbbbbbbbbbbbbbbbbb", "admin-1", "event_image", NOW, NOW);
  const insertMediaLink = database.prepare(`INSERT INTO media_links (
    media_id, entity_type, entity_id, slot, audience, sort_order, attached_at
  ) VALUES (?, ?, ?, ?, 'public', 0, ?)`);
  insertMediaLink.run("aaaaaaaaaaaaaaaaaaaaa", "member_profile", "member-1", "avatar", NOW);
  insertMediaLink.run("bbbbbbbbbbbbbbbbbbbbb", "event", "event-public", "attachment", NOW);

  database.prepare(`INSERT INTO announcements (
    id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
    created_by, updated_by, revision_token, created_at, updated_at
  ) VALUES (?, ?, '{}', 0, 'published', ?, NULL, NULL, ?, NULL, ?, ?, ?)`)
    .run("announcement-dragon", "Dragon Notice", NOW, "admin-1", "announcement-revision-01", NOW, NOW);
  database.prepare(`INSERT INTO wiki_categories (
    id, name, slug, sort_order, parent_id, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?)`)
    .run("wiki-category", "Guides", "guides", "wiki-category-revision-01", NOW, NOW);
  database.prepare(`INSERT INTO wiki_articles (
    id, title, slug, category_id, body_json, sort_order, pinned, archived_at,
    created_by, updated_by, current_revision, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, ?, '{}', 0, 0, NULL, ?, NULL, 1, ?, ?, ?)`)
    .run("wiki-dragon", "Dragon Guide", "dragon-guide", "wiki-category", "admin-1", "wiki-article-revision-001", NOW, NOW);
  database.prepare(`INSERT INTO wiki_articles (
    id, title, slug, category_id, body_json, sort_order, pinned, archived_at, deleted_at,
    created_by, updated_by, current_revision, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, ?, '{}', 0, 0, ?, ?, ?, NULL, 1, ?, ?, ?)`)
    .run(
      "wiki-deleted-secret", "Secret Deleted Guide", "secret-deleted-guide", "wiki-category",
      NOW, NOW, "admin-1", "wiki-deleted-revision-01", NOW, NOW,
    );
  database.prepare(`INSERT INTO gallery_items (
    id, type, url, caption, uploaded_by, revision_token, created_at
  ) VALUES (?, 'video', ?, ?, ?, ?, ?)`)
    .run("gallery-dragon", "https://www.youtube.com/watch?v=dragon", "Dragon Gallery", "admin-1", "gallery-revision-token-01", NOW);

  database.prepare(`INSERT INTO guild_wars (
    id, event_id, status, war_name, enemy_name, result, concluded_at,
    created_by, created_at, updated_at
  ) VALUES (?, NULL, 'concluded', ?, ?, ?, ?, ?, ?, ?)`)
    .run("war-loss", "Older Battle", "Iron Guard", "loss", "2026-08-08T12:00:00.000Z", "admin-1", "2026-08-08T12:00:00.000Z", "2026-08-08T12:00:00.000Z");
  database.prepare(`INSERT INTO guild_wars (
    id, event_id, status, war_name, enemy_name, result, concluded_at,
    created_by, created_at, updated_at
  ) VALUES (?, ?, 'active', ?, ?, NULL, NULL, ?, ?, ?)`)
    .run("war-win", "event-war", "Dragon War", "Dragon Legion", "admin-1", NOW, NOW);
  database.prepare(`INSERT INTO war_teams (
    id, war_id, team_name, sort_order, notes, is_locked
  ) VALUES (?, ?, 'Team A', 0, NULL, 0)`)
    .run("war-team-1", "war-win");
  database.prepare(`INSERT INTO war_members (
    id, war_id, team_id, user_id, sort_order, damage, healing, damage_taken, building_damage
  ) VALUES (?, ?, ?, ?, 0, 120, 15, 40, 30)`)
    .run("war-member-1", "war-win", "war-team-1", "member-1");
  database.prepare(`UPDATE guild_wars
    SET status = 'concluded', result = 'win', concluded_at = ?, updated_at = ?
    WHERE id = ?`)
    .run(NOW, NOW, "war-win");
  database.prepare("UPDATE events SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(NOW, NOW, "event-war");
}

function explain(database: DatabaseSync, statement: SqlStatement): string {
  const prepared = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`);
  const rows = prepared.all(...([...(statement.params ?? [])] as SQLInputValue[])) as Array<{ detail: string }>;
  return rows.map(({ detail }) => detail).join("\n");
}
