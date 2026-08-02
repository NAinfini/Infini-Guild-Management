import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { SystemTestService } from "../SystemTestService";

function createEnv() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        statements.push({ sql, params });
        return { run: async () => ({ meta: { changes: 1 } }), first: async () => undefined, all: async () => ({ results: [] }) };
      },
    }),
    batch: async () => [],
  };
  const MEDIA = { delete: vi.fn().mockResolvedValue(undefined) };
  return { env: { DB, MEDIA }, statements, MEDIA };
}

function createSqliteD1(db: DatabaseSync) {
  type BoundStatement = ReturnType<typeof bound>;
  function bound(sql: string, params: SQLInputValue[] = []) {
    return {
      bind: (...nextParams: SQLInputValue[]) => bound(sql, nextParams),
      run: async () => {
        const result = db.prepare(sql).run(...params);
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => (db.prepare(sql).get(...params) as T | undefined) ?? null,
      all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    };
  }
  return {
    prepare: (sql: string) => bound(sql),
    batch: async (statements: BoundStatement[]) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

describe("SystemTestService exact compensation", () => {
  it("issues a different server-generated UID for every run", async () => {
    const { env, statements } = createEnv();
    const service = new SystemTestService(env as never);

    const first = await service.createRun("admin-1");
    const second = await service.createRun("admin-1");

    expect(first).not.toBe(second);
    expect(statements.filter((statement) => statement.sql.startsWith("INSERT INTO system_test_runs")))
      .toHaveLength(2);
  });

  it("deletes only registered exact IDs, media references, and R2 keys", async () => {
    const { env, statements, MEDIA } = createEnv();
    await new SystemTestService(env as never).cleanupExactArtifacts([
      { type: "gallery_item", key: "gallery-test-1" },
      { type: "r2_key", key: "gallery/gallery-test-1/image.png" },
    ]);

    expect(statements).toEqual(expect.arrayContaining([
      expect.objectContaining({ sql: "DELETE FROM gallery_items WHERE id = ?", params: ["gallery-test-1"] }),
      expect.objectContaining({ sql: "DELETE FROM media_references WHERE media_key = ?", params: ["gallery/gallery-test-1/image.png"] }),
    ]));
    expect(statements.some((statement) => /\bLIKE\b/i.test(statement.sql))).toBe(false);
    expect(MEDIA.delete).toHaveBeenCalledWith("gallery/gallery-test-1/image.png");
  });

  it("uses child-first cleanup for compensated event, template, war, and error UUIDs", async () => {
    const { env, statements } = createEnv();
    await new SystemTestService(env as never).cleanupExactArtifacts([
      { type: "event", key: "event-1" },
      { type: "event_template", key: "template-1" },
      { type: "war_history", key: "war-1" },
      { type: "error_log", key: "error-1" },
    ]);

    const sql = statements.map((statement) => statement.sql);
    expect(sql.some((query) => query.includes("DELETE FROM war_team_members"))).toBe(true);
    expect(sql.some((query) => query.includes("DELETE FROM event_poll_votes"))).toBe(true);
    expect(sql.some((query) => query.includes("SELECT id FROM events WHERE series_id = ?"))).toBe(true);
    expect(statements).toContainEqual(expect.objectContaining({
      sql: "DELETE FROM error_log WHERE id = ?",
      params: ["error-1"],
    }));
    expect(sql.every((query) => !/\bLIKE\b/iu.test(query))).toBe(true);
  });

  it("registers artifacts only while the run is accepting requests", async () => {
    const statements: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: () => {
          statements.push(sql);
          return {};
        },
      }),
      batch: async () => [{ meta: { changes: 0 } }],
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).registerArtifacts("run-1", [
      { type: "event", key: "event-1" },
    ])).rejects.toThrow("no longer accepting artifacts");

    expect(statements[0]).toContain("FROM system_test_runs");
    expect(statements[0]).toContain("status = 'running'");
  });

  it("does not claim cleanup while a request lease is active", async () => {
    const queries: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            queries.push(sql);
            if (sql.startsWith("SELECT id, actor_id")) {
              return {
                id: "run-1",
                actor_id: "admin-1",
                status: "running",
                active_requests: 1,
                cleanup_attempts: 0,
              };
            }
            if (sql.startsWith("SELECT status")) {
              return { status: "running", cleanup_attempts: 0 };
            }
            return undefined;
          },
          run: async () => {
            queries.push(sql);
            return { meta: { changes: 0 } };
          },
        }),
      }),
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).cleanupRun("run-1", "admin-1")).resolves.toEqual({
      status: "running",
      attempts: 0,
    });

    expect(queries.some((sql) => sql.includes("active_requests = 0"))).toBe(true);
    expect(queries.some((sql) => sql.startsWith("SELECT artifact_type"))).toBe(false);
  });

  it("moves a third failed cleanup attempt to manual review without marker SQL", async () => {
    const updates: unknown[][] = [];
    const DB = {
      prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
        first: async () => sql.startsWith("SELECT id, actor_id") ? { id: "run-1", actor_id: "admin-1", status: "cleanup_failed", cleanup_attempts: 2 } : undefined,
        all: async () => { if (sql.startsWith("SELECT artifact_type")) throw new Error("D1 unavailable"); return { results: [] }; },
        run: async () => { if (sql.startsWith("UPDATE system_test_runs")) updates.push(params); return { meta: { changes: 1 } }; },
      }) }),
      batch: async () => [],
    };
    const service = new SystemTestService({ DB, MEDIA: { delete: async () => undefined } } as never);
    await expect(service.cleanupRun("run-1", "admin-1")).resolves.toEqual({ status: "manual_review", attempts: 3 });
    expect(updates.some((params) => params.includes("manual_review"))).toBe(true);
  });

  it("finds abandoned work only through the run registry", async () => {
    const queries: string[] = [];
    const DB = {
      prepare: (sql: string) => {
        queries.push(sql);
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 0 } }),
            all: async () => ({ results: [] }),
          }),
        };
      },
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).cleanupStaleRuns()).resolves.toEqual({
      processed: 0,
      completed: 0,
      manualReview: 0,
    });

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.includes("system_test_runs"))).toBe(true);
    expect(queries.some((query) => query.includes("status = 'completed'"))).toBe(true);
    expect(queries.every((query) => !/\b(?:announcements|events|wiki_articles|gallery_items)\b/iu.test(query))).toBe(true);
    expect(queries.every((query) => !/\bLIKE\b/iu.test(query))).toBe(true);
  });

  it("finalizes an empty completed run and keeps only a stable audit summary identity", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          statements.push({ sql, params });
          return {};
        },
      }),
      batch: async (batch: unknown[]) => batch.map(() => ({ meta: { changes: 1 } })),
    };
    const service = new SystemTestService({ DB, MEDIA: { delete: async () => undefined } } as never);

    await expect(service.finalizeRun("run-private-uuid", "admin-1", {
      diffTitle: "Full system test: 2/2 passed",
      detailText: JSON.stringify({ total: 2, passed: 2, failed: 0, errors: [] }),
    })).resolves.toBeUndefined();

    expect(statements[0]?.sql).toContain("INSERT INTO audit_log");
    expect(statements[0]?.sql).toContain("'admin-console-api'");
    expect(statements[0]?.sql).not.toContain("entity_id, diff_title, detail_text) VALUES");
    expect(statements.at(-1)).toEqual(expect.objectContaining({
      params: ["run-private-uuid", "admin-1"],
    }));
  });

  it("treats a missing run as already finalized so client retries are safe", async () => {
    const DB = {
      prepare: (sql: string) => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 0 } }),
          first: async () => sql.startsWith("SELECT actor_id") ? undefined : undefined,
        }),
      }),
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).finalizeRun("already-removed", "admin-1")).resolves.toBeUndefined();
  });

  it("removes every registered root UUID, generated child UUID, control row, media reference, and R2 object", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(readFileSync(
      new URL("../../db/migrations/0000_core_schema.sql", import.meta.url),
      "utf8",
    ));
    const insert = (sql: string, ...params: SQLInputValue[]) => sqlite.prepare(sql).run(...params);
    const ids = {
      run: "00000000-0000-4000-8000-000000000001",
      user: "00000000-0000-4000-8000-000000000002",
      invite: "00000000-0000-4000-8000-000000000003",
      event: "00000000-0000-4000-8000-000000000004",
      generatedEvent: "00000000-0000-4000-8000-000000000005",
      template: "00000000-0000-4000-8000-000000000006",
      pollOption: "00000000-0000-4000-8000-000000000007",
      pollVote: "00000000-0000-4000-8000-000000000008",
      raffleWinner: "00000000-0000-4000-8000-000000000009",
      participant: "00000000-0000-4000-8000-000000000010",
      eventTeam: "00000000-0000-4000-8000-000000000011",
      eventTeamMember: "00000000-0000-4000-8000-000000000012",
      eventPoolMember: "00000000-0000-4000-8000-000000000013",
      announcement: "00000000-0000-4000-8000-000000000014",
      gallery: "00000000-0000-4000-8000-000000000015",
      war: "00000000-0000-4000-8000-000000000016",
      warTeam: "00000000-0000-4000-8000-000000000017",
      warTeamMember: "00000000-0000-4000-8000-000000000018",
      warPoolMember: "00000000-0000-4000-8000-000000000019",
      wikiCategory: "00000000-0000-4000-8000-000000000020",
      wikiArticle: "00000000-0000-4000-8000-000000000021",
      wikiRevision: "00000000-0000-4000-8000-000000000022",
      badge: "00000000-0000-4000-8000-000000000023",
      storage: "00000000-0000-4000-8000-000000000024",
      storageCategory: "00000000-0000-4000-8000-000000000025",
      storageItem: "00000000-0000-4000-8000-000000000026",
      storageImage: "00000000-0000-4000-8000-000000000027",
      storageTransaction: "00000000-0000-4000-8000-000000000028",
      audit: "00000000-0000-4000-8000-000000000029",
      storageMarker: "storage-batch-0000000000000000000000000000000000000000000000000000000000000000",
      error: "00000000-0000-4000-8000-000000000030",
      session: "00000000-0000-4000-8000-000000000031",
      classCatalog: "00000000-0000-4000-8000-000000000033",
      absence: "00000000-0000-4000-8000-000000000034",
      // 挂在既有成员身上的请假：users 的级联带不走它，只能靠显式登记。
      absenceOnExistingMember: "00000000-0000-4000-8000-000000000035",
    };
    const roleId = "systemtest_role_cleanup";
    const username = "systemtest_cleanup_user";
    const mediaKeys = [
      "profiles/cleanup/profile.png",
      "events/cleanup/event.png",
      "announcements/cleanup/announcement.png",
      "gallery/cleanup/gallery.png",
      "wiki/cleanup/wiki.png",
      "storage/cleanup/storage.png",
      "classes/cleanup/icon.png",
    ] as const;

    try {
      insert("INSERT INTO users (id, username, role) VALUES ('admin-1', 'admin', 'admin')");
      insert("INSERT INTO roles (id, name, level) VALUES (?, 'System test role', 1)", roleId);
      insert("INSERT INTO role_permissions (role_id, permission, granted) VALUES (?, 'events.create', 1)", roleId);
      insert("INSERT INTO users (id, username, role) VALUES (?, ?, ?)", ids.user, username, roleId);
      insert("INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (?, 'hash', 'salt')", ids.user);
      insert("INSERT INTO member_profiles (id, user_id, avatar_key, images, audio_key) VALUES (?, ?, ?, ?, ?)",
        "00000000-0000-4000-8000-000000000032", ids.user, mediaKeys[0], JSON.stringify([mediaKeys[0]]), mediaKeys[0]);
      insert("INSERT INTO member_profile_classes (user_id, class) VALUES (?, 'mage')", ids.user);
      insert("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z')", ids.session, ids.user);
      insert("INSERT INTO login_failures (username, fail_count) VALUES (?, 2)", username);
      insert("INSERT INTO system_test_runs (id, actor_id) VALUES (?, 'admin-1')", ids.run);
      insert("INSERT INTO invite_links (id, code, created_by, max_uses, used_count) VALUES (?, 'TESTCLEANUPCODE', 'admin-1', 1, 1)", ids.invite);
      insert("INSERT INTO recurring_templates (id, type, title, start_time, recurrence_rule, created_by) VALUES (?, 'social', 'test', '12:00', '{}', 'admin-1')", ids.template);
      insert("INSERT INTO events (id, type, title, start_at, created_by) VALUES (?, 'poll', 'test', '2099-01-01T00:00:00.000Z', 'admin-1')", ids.event);
      insert("INSERT INTO events (id, type, title, start_at, created_by, series_id) VALUES (?, 'social', 'generated', '2099-01-02T00:00:00.000Z', 'admin-1', ?)", ids.generatedEvent, ids.template);
      insert("INSERT INTO event_polls (event_id) VALUES (?)", ids.event);
      insert("INSERT INTO event_poll_options (id, event_id, label) VALUES (?, ?, 'one')", ids.pollOption, ids.event);
      insert("INSERT INTO event_poll_votes (id, event_id, option_id, user_id) VALUES (?, ?, ?, ?)", ids.pollVote, ids.event, ids.pollOption, ids.user);
      insert("INSERT INTO event_raffle_winners (id, event_id, user_id) VALUES (?, ?, ?)", ids.raffleWinner, ids.event, ids.user);
      insert("INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)", ids.participant, ids.event, ids.user);
      insert("INSERT INTO war_teams (id, event_id, team_name) VALUES (?, ?, 'event team')", ids.eventTeam, ids.event);
      insert("INSERT INTO war_team_members (id, war_team_id, user_id) VALUES (?, ?, ?)", ids.eventTeamMember, ids.eventTeam, ids.user);
      insert("INSERT INTO war_pool_members (id, event_id, user_id) VALUES (?, ?, ?)", ids.eventPoolMember, ids.event, ids.user);
      insert("INSERT INTO announcements (id, title, body_json, created_by) VALUES (?, 'test', '{}', 'admin-1')", ids.announcement);
      insert("INSERT INTO gallery_items (id, type, url, uploaded_by) VALUES (?, 'image', ?, 'admin-1')", ids.gallery, mediaKeys[3]);
      insert("INSERT INTO war_history (id, event_id, war_name, created_by) VALUES (?, ?, 'test war', 'admin-1')", ids.war, ids.generatedEvent);
      insert("INSERT INTO war_teams (id, war_history_id, team_name) VALUES (?, ?, 'history team')", ids.warTeam, ids.war);
      insert("INSERT INTO war_team_members (id, war_team_id, user_id) VALUES (?, ?, ?)", ids.warTeamMember, ids.warTeam, ids.user);
      insert("INSERT INTO war_pool_members (id, war_history_id, user_id) VALUES (?, ?, ?)", ids.warPoolMember, ids.war, ids.user);
      insert("INSERT INTO wiki_categories (id, name, slug) VALUES (?, 'test', 'test-cleanup')", ids.wikiCategory);
      insert("INSERT INTO wiki_articles (id, title, slug, category_id, body_json, created_by) VALUES (?, 'test', 'test-cleanup', ?, '{}', 'admin-1')", ids.wikiArticle, ids.wikiCategory);
      insert("INSERT INTO wiki_revisions (id, article_id, revision, title, body_json, edited_by) VALUES (?, ?, 1, 'test', '{}', 'admin-1')", ids.wikiRevision, ids.wikiArticle);
      insert("INSERT INTO member_badges (id, name, label_html) VALUES (?, 'test', '<span>test</span>')", ids.badge);
      insert("INSERT INTO member_badge_assignments (badge_id, user_id, assigned_by) VALUES (?, ?, 'admin-1')", ids.badge, ids.user);
      insert("INSERT INTO storages (id, name) VALUES (?, 'test')", ids.storage);
      insert("INSERT INTO storage_categories (id, storage_id, name) VALUES (?, ?, 'test')", ids.storageCategory, ids.storage);
      insert("INSERT INTO storage_items (id, storage_id, category_id, name, quantity) VALUES (?, ?, ?, 'test', 1)", ids.storageItem, ids.storage, ids.storageCategory);
      insert("INSERT INTO storage_item_images (id, item_id, r2_key) VALUES (?, ?, ?)", ids.storageImage, ids.storageItem, mediaKeys[5]);
      insert("INSERT INTO storage_transactions (id, item_id, type, quantity_delta, recipient_user_id, actor_id) VALUES (?, ?, 'intake', 1, ?, 'admin-1')", ids.storageTransaction, ids.storageItem, ids.user);
      insert("INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id) VALUES (?, 'event', 'create', ?, ?)", ids.audit, ids.user, ids.event);
      insert("INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id) VALUES (?, 'storage_transaction', 'intake', 'admin-1', ?)", ids.storageMarker, ids.storageMarker);
      insert("INSERT INTO error_log (id, source, message) VALUES (?, 'request', 'test error')", ids.error);
      insert(
        "INSERT INTO class_catalog (id, label, color, icon_type, vector_icon, icon_key) VALUES (?, 'System test class', '#AABBCC', 'image', 'sword', ?)",
        ids.classCatalog, mediaKeys[6],
      );
      insert("INSERT INTO member_absences (id, user_id, start_date, end_date) VALUES (?, ?, '2099-01-01', '2099-01-03')", ids.absence, ids.user);
      insert("INSERT INTO member_absences (id, user_id, start_date, end_date) VALUES (?, 'admin-1', '2099-02-01', '2099-02-03')", ids.absenceOnExistingMember);
      const mediaReferences: Array<[string, string, string]> = [
        ["member_profile", ids.user, mediaKeys[0]],
        ["event", ids.event, mediaKeys[1]],
        ["announcement", ids.announcement, mediaKeys[2]],
        ["gallery", ids.gallery, mediaKeys[3]],
        ["wiki_article", ids.wikiArticle, mediaKeys[4]],
        ["storage_item", ids.storageItem, mediaKeys[5]],
        ["class_icon", ids.classCatalog, mediaKeys[6]],
      ];
      for (const [entityType, entityId, mediaKey] of mediaReferences) {
        insert("INSERT INTO media_references (media_key, entity_type, entity_id) VALUES (?, ?, ?)", mediaKey, entityType, entityId);
      }

      const artifacts: Array<[string, string]> = [
        ["user", ids.user], ["invite_link", ids.invite], ["role", roleId],
        ["event", ids.event], ["event_template", ids.template],
        ["announcement", ids.announcement], ["gallery_item", ids.gallery],
        ["war_history", ids.war], ["wiki_category", ids.wikiCategory],
        ["wiki_article", ids.wikiArticle], ["badge", ids.badge],
        ["storage", ids.storage], ["storage_category", ids.storageCategory],
        ["storage_item", ids.storageItem], ["storage_item_image", ids.storageImage],
        ["audit_log", ids.audit], ["audit_log", ids.storageMarker],
        ["error_log", ids.error],
        ["class_catalog", ids.classCatalog],
        ["member_absence", ids.absence], ["member_absence", ids.absenceOnExistingMember],
        ...mediaKeys.map((key): [string, string] => ["r2_key", key]),
      ];
      for (const [type, key] of artifacts) {
        insert("INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key) VALUES (?, ?, ?)", ids.run, type, key);
      }

      const r2Objects = new Set<string>(mediaKeys);
      const service = new SystemTestService({
        DB: createSqliteD1(sqlite),
        MEDIA: { delete: async (key: string) => { r2Objects.delete(key); } },
      } as never);
      await expect(service.cleanupRun(ids.run, "admin-1")).resolves.toMatchObject({ status: "completed" });
      await expect(service.finalizeRun(ids.run, "admin-1")).resolves.toBeUndefined();

      const residueQueries = [
        ["system_test_runs", "id", ids.run],
        ["system_test_artifacts", "run_id", ids.run],
        ["users", "id", ids.user],
        ["roles", "id", roleId],
        ["role_permissions", "role_id", roleId],
        ["sessions", "id", ids.session],
        ["login_failures", "username", username],
        ["member_profiles", "user_id", ids.user],
        ["member_profile_classes", "user_id", ids.user],
        ["invite_links", "id", ids.invite],
        ["events", "id", ids.event],
        ["events", "id", ids.generatedEvent],
        ["recurring_templates", "id", ids.template],
        ["event_polls", "event_id", ids.event],
        ["event_poll_options", "id", ids.pollOption],
        ["event_poll_votes", "id", ids.pollVote],
        ["event_raffle_winners", "id", ids.raffleWinner],
        ["event_participants", "id", ids.participant],
        ["war_history", "id", ids.war],
        ["war_teams", "id", ids.eventTeam],
        ["war_teams", "id", ids.warTeam],
        ["war_team_members", "id", ids.eventTeamMember],
        ["war_team_members", "id", ids.warTeamMember],
        ["war_pool_members", "id", ids.eventPoolMember],
        ["war_pool_members", "id", ids.warPoolMember],
        ["announcements", "id", ids.announcement],
        ["gallery_items", "id", ids.gallery],
        ["wiki_categories", "id", ids.wikiCategory],
        ["wiki_articles", "id", ids.wikiArticle],
        ["wiki_revisions", "id", ids.wikiRevision],
        ["member_badges", "id", ids.badge],
        ["member_badge_assignments", "badge_id", ids.badge],
        ["storages", "id", ids.storage],
        ["storage_categories", "id", ids.storageCategory],
        ["storage_items", "id", ids.storageItem],
        ["storage_item_images", "id", ids.storageImage],
        ["storage_transactions", "id", ids.storageTransaction],
        ["audit_log", "id", ids.audit],
        ["audit_log", "id", ids.storageMarker],
        ["error_log", "id", ids.error],
        ["class_catalog", "id", ids.classCatalog],
        ["member_absences", "id", ids.absence],
        ["member_absences", "id", ids.absenceOnExistingMember],
      ] as const;
      for (const [table, column, value] of residueQueries) {
        const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as { count: number };
        expect(Number(row.count), `${table}.${column} retained ${value}`).toBe(0);
      }
      for (const mediaKey of mediaKeys) {
        const row = sqlite.prepare("SELECT COUNT(*) AS count FROM media_references WHERE media_key = ?").get(mediaKey) as { count: number };
        expect(Number(row.count), `media_references retained ${mediaKey}`).toBe(0);
      }
      expect(r2Objects).toEqual(new Set());
    } finally {
      sqlite.close();
    }
  });
});
