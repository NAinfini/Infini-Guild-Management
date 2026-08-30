import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { WikiArticleRecord, WikiRevisionRecord } from "@guild/server/modules/wiki";
import { createAuditEvent, type AuditEventWrite } from "@guild/server/modules/audit";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SQL_BATCH_STATEMENTS,
  createAuthorizationContext,
  createRequestContext,
} from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";
import type { SqlStatement } from "@guild/kernel";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteMediaStore } from "./media-store.js";
import { SqliteWikiStore } from "./wiki-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const PUBLIC_SCOPE = { kind: "public" } as const;
const OWNED_SCOPE = { kind: "owned", ownerUserId: "user-1" } as const;
const ALL_SCOPE = { kind: "all" } as const;
const PUBLIC_CONTENT_SCOPES = { announcement: PUBLIC_SCOPE, wikiArticle: PUBLIC_SCOPE } as const;
const WIKI_TRIGGERS = readFileSync(
  fileURLToPath(new URL("../schema/wiki-triggers.sql", import.meta.url)),
  "utf8",
);
const MEDIA_TRIGGERS = readFileSync(
  fileURLToPath(new URL("../schema/media-triggers.sql", import.meta.url)),
  "utf8",
);
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(SCHEMA);
  database.exec(WIKI_TRIGGERS);
  database.exec(MEDIA_TRIGGERS);
  database.prepare("INSERT INTO users (id, display_name) VALUES ('user-1', 'owner')").run();
  database.prepare("INSERT INTO users (id, display_name) VALUES ('user-2', 'other owner')").run();
  database.prepare("INSERT INTO wiki_category_state (singleton, revision_token, updated_at) VALUES (1, 'state-1', ?)").run(NOW);
  database.prepare("INSERT INTO wiki_categories (id, name, slug, revision_token) VALUES ('category-1', 'Root', 'root', 'category-revision-1')").run();
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteWikiStore(executor) };
}

function article(overrides: Partial<WikiArticleRecord> = {}): WikiArticleRecord {
  return {
    id: "article-1",
    title: "Guide",
    slug: "guide",
    category_id: "category-1",
    body_json: JSON.stringify({ type: "doc", content: [] }),
    sort_order: 0,
    pinned: false,
    view_count: 0,
    excerpt: "",
    preview_media_id: null,
    archived_at: null,
    deletedAt: null,
    created_by: "user-1",
    updated_by: null,
    updated_by_display_name: null,
    created_at: NOW,
    updated_at: NOW,
    revisionToken: "article-revision-1",
    currentRevision: 1,
    mediaIds: [],
    ...overrides,
  };
}

function revision(record: WikiArticleRecord, id = `revision-${record.currentRevision}`): WikiRevisionRecord {
  return {
    id,
    article_id: record.id,
    revision: record.currentRevision,
    title: record.title,
    slug: record.slug,
    category_id: record.category_id,
    body_json: record.body_json,
    sort_order: record.sort_order,
    pinned: record.pinned,
    archived_at: record.archived_at,
    deleted_at: record.deletedAt,
    media_ids: [...record.mediaIds],
    edited_by: "user-1",
    edited_by_display_name: null,
    restored_from: null,
    created_at: record.updated_at,
  };
}

function audit(id: string): AuditEventWrite {
  const context = createRequestContext({
    requestId: `request-${id}`,
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
    now: NOW,
  });
  return {
    ...createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: "article-1",
      subjectLabel: "Guide",
      action: "update",
    }),
    eventId: id,
  };
}

function seedMedia(database: DatabaseSync, id: string): void {
  database.prepare(`INSERT INTO media_assets
    (id, owner_user_id, purpose, media_type, state, created_at, updated_at)
    VALUES (?, 'user-1', 'wiki_image', 'image', 'staged', ?, ?)`).run(id, NOW, NOW);
  database.prepare(`INSERT INTO media_variants (media_id, variant, object_key)
    VALUES (?, 'view', ?)`).run(id, `media/${id}/view.webp`);
}

function wikiMediaId(index: number): string {
  return `wiki-media-${String(index).padStart(2, "0")}`;
}

function categoryRecord(index: number): import("@guild/server/modules/wiki").WikiCategoryRecord {
  return {
    id: `category-${index}`,
    name: `Category ${index}`,
    slug: `category-${index}`,
    sort_order: index,
    created_at: NOW,
    updated_at: NOW,
    revisionToken: `category-revision-${index}`,
  };
}

describe("SqliteWikiStore category catalog bounds", () => {
  it("accepts the maximum category and atomically rejects max plus one without audit", async () => {
    const { database, store } = harness();
    const insert = database.prepare(`INSERT INTO wiki_categories
      (id, name, slug, sort_order, parent_id, revision_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
    for (let index = 2; index < LIMITS.content.wikiCategoryCatalog.max; index += 1) {
      const record = categoryRecord(index);
      insert.run(record.id, record.name, record.slug, record.sort_order, record.revisionToken, NOW, NOW);
    }

    await expect(store.createCategory({
      record: categoryRecord(200), expectedStateToken: "state-1", stateToken: "state-2",
      audit: audit("audit-category-200"),
    })).resolves.toBe("created");
    await expect(store.createCategory({
      record: categoryRecord(201), expectedStateToken: "state-2", stateToken: "state-3",
      audit: audit("audit-category-201"),
    })).resolves.toBe("limit_reached");

    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories").get())
      .toMatchObject({ count: LIMITS.content.wikiCategoryCatalog.max });
    expect(database.prepare("SELECT revision_token FROM wiki_category_state WHERE singleton = 1").get())
      .toMatchObject({ revision_token: "state-2" });
    expect(database.prepare("SELECT count(*) AS count FROM audit_log").get()).toMatchObject({ count: 1 });
  });

  it("keeps a stale concurrent category create out of the tree", async () => {
    const { database, store } = harness();
    await expect(store.createCategory({
      record: categoryRecord(2), expectedStateToken: "state-1", stateToken: "state-2",
      audit: audit("audit-category-first"),
    })).resolves.toBe("created");
    await expect(store.createCategory({
      record: categoryRecord(3), expectedStateToken: "state-1", stateToken: "state-3",
      audit: audit("audit-category-stale"),
    })).resolves.toBe("conflict");
    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories WHERE id = 'category-3'").get())
      .toMatchObject({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM audit_log").get()).toMatchObject({ count: 1 });
  });

  it("keeps a stale category batch from changing rows or writing an audit", async () => {
    const { database, store } = harness();
    const first = {
      ...categoryRecord(1),
      id: "category-1",
      name: "First rename",
      slug: "root",
      revisionToken: "category-revision-2",
    };
    const stale = {
      ...first,
      name: "Stale rename",
      revisionToken: "category-revision-3",
    };

    await expect(store.updateCategories({
      records: [first], expectedStateToken: "state-1", stateToken: "state-2",
      audit: audit("audit-category-first-update"),
    })).resolves.toBe(true);
    await expect(store.updateCategories({
      records: [stale], expectedStateToken: "state-1", stateToken: "state-3",
      audit: audit("audit-category-stale-update"),
    })).resolves.toBe(false);

    expect(database.prepare("SELECT name, revision_token FROM wiki_categories WHERE id = 'category-1'").get())
      .toEqual({ name: "First rename", revision_token: "category-revision-2" });
    expect(database.prepare("SELECT revision_token FROM wiki_category_state WHERE singleton = 1").get())
      .toEqual({ revision_token: "state-2" });
    expect(database.prepare("SELECT count(*) AS count FROM audit_log WHERE id = 'audit-category-stale-update'").get())
      .toEqual({ count: 0 });
  });

  it("rolls category and state back when the audit write fails", async () => {
    const { database, store } = harness();
    database.exec("CREATE TRIGGER reject_category_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;");
    await expect(store.createCategory({
      record: categoryRecord(2), expectedStateToken: "state-1", stateToken: "state-2",
      audit: audit("audit-category-rejected"),
    })).rejects.toThrow(/audit rejected/);
    expect(database.prepare("SELECT count(*) AS count FROM wiki_categories").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT revision_token FROM wiki_category_state WHERE singleton = 1").get())
      .toMatchObject({ revision_token: "state-1" });
  });

  it("fails explicitly when persisted categories exceed the catalog invariant", async () => {
    const { database, store } = harness();
    const insert = database.prepare(`INSERT INTO wiki_categories
      (id, name, slug, sort_order, parent_id, revision_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
    for (let index = 2; index <= LIMITS.content.wikiCategoryCatalog.max + 1; index += 1) {
      const record = categoryRecord(index);
      insert.run(record.id, record.name, record.slug, record.sort_order, record.revisionToken, NOW, NOW);
    }
    await expect(store.listCategories()).rejects.toMatchObject({ code: "SERVER_ERROR", status: 500 });
  });
});

describe("SqliteWikiStore immutable snapshots", () => {
  it("keeps a stale history restore from changing the article, snapshots, media, or audit", async () => {
    const { database, store } = harness();
    seedMedia(database, "media-old");
    seedMedia(database, "media-new");
    const initial = article({ mediaIds: ["media-old"] });
    await store.createArticle({
      record: initial,
      initialRevision: revision(initial),
      mediaIds: initial.mediaIds,
      audit: { ...audit("audit-create"), action: "create" },
    });
    const concurrent = article({
      title: "Concurrent edit",
      updated_by: "user-1",
      updated_at: "2026-08-09T12:00:01.000Z",
      revisionToken: "article-revision-2",
      currentRevision: 2,
      mediaIds: ["media-new"],
    });
    await store.mutateArticle({
      record: concurrent,
      expectedRevisionToken: initial.revisionToken,
      revision: revision(concurrent),
      mediaIds: concurrent.mediaIds,
      audit: audit("audit-concurrent"),
    });
    const staleRestore = article({
      title: "Stale restore",
      updated_by: "user-1",
      updated_at: "2026-08-09T12:00:02.000Z",
      revisionToken: "article-revision-3",
      currentRevision: 3,
      mediaIds: ["media-old"],
    });

    await expect(store.mutateArticle({
      record: staleRestore,
      expectedRevisionToken: initial.revisionToken,
      revision: { ...revision(staleRestore), restored_from: 1 },
      mediaIds: staleRestore.mediaIds,
      audit: { ...audit("audit-stale-restore"), action: "rollback" },
    })).resolves.toBe(false);

    expect(database.prepare("SELECT title, current_revision FROM wiki_articles WHERE id = 'article-1'").get())
      .toEqual({ title: "Concurrent edit", current_revision: 2 });
    expect(database.prepare("SELECT count(*) AS count FROM wiki_revisions WHERE article_id = 'article-1'").get())
      .toEqual({ count: 2 });
    expect(database.prepare(`SELECT media_id FROM media_links
      WHERE entity_type = 'wiki_article' AND entity_id = 'article-1'`).all())
      .toEqual([{ media_id: "media-new" }]);
    expect(database.prepare("SELECT count(*) AS count FROM audit_log WHERE id = 'audit-stale-restore'").get())
      .toEqual({ count: 0 });
  });

  it("commits current state, revision media, CAS, and audit in one batch without dropping historical media", async () => {
    const { database, executor, store } = harness();
    seedMedia(database, "media-old");
    seedMedia(database, "media-new");
    const initial = article({ mediaIds: ["media-old"] });
    await store.createArticle({
      record: initial,
      initialRevision: revision(initial),
      mediaIds: initial.mediaIds,
      audit: { ...audit("audit-create"), action: "create" },
    });

    const changed = article({
      title: "Guide 2",
      slug: "guide-2",
      sort_order: 3,
      pinned: true,
      archived_at: NOW,
      updated_by: "user-1",
      revisionToken: "article-revision-2",
      currentRevision: 2,
      mediaIds: ["media-new"],
    });
    expect(await store.mutateArticle({
      record: changed,
      expectedRevisionToken: initial.revisionToken,
      revision: revision(changed),
      mediaIds: changed.mediaIds,
      audit: audit("audit-update"),
    })).toBe(true);

    expect(executor.batches.at(-1)?.some(({ sql }) => sql.includes("INSERT INTO wiki_revision_media"))).toBe(true);
    expect(database.prepare("SELECT media_id FROM wiki_revision_media WHERE revision_id = 'revision-1'").get())
      .toMatchObject({ media_id: "media-old" });
    expect(database.prepare("SELECT media_id FROM wiki_revision_media WHERE revision_id = 'revision-2'").get())
      .toMatchObject({ media_id: "media-new" });
    expect(database.prepare("SELECT state FROM media_assets WHERE id = 'media-old'").get())
      .toMatchObject({ state: "attached" });
    const mediaStore = new SqliteMediaStore(executor);
    expect(await mediaStore.describeRead("media-old", "view", NOW, PUBLIC_CONTENT_SCOPES)).toMatchObject({
      audience: "private",
      entityTypes: ["wiki_article"],
    });
    expect(await mediaStore.claimGarbage("2026-08-10T12:00:00.000Z", 50)).toEqual([]);

    const restored = article({
      updated_by: "user-1",
      updated_at: "2026-08-09T12:00:01.000Z",
      revisionToken: "article-revision-3",
      currentRevision: 3,
      mediaIds: ["media-old"],
    });
    await store.mutateArticle({
      record: restored,
      expectedRevisionToken: changed.revisionToken,
      revision: { ...revision(restored), restored_from: 1 },
      mediaIds: restored.mediaIds,
      audit: { ...audit("audit-restore"), action: "rollback" },
    });
    expect(database.prepare(`SELECT media_id FROM media_links
      WHERE entity_type = 'wiki_article' AND entity_id = 'article-1'`).all())
      .toEqual([{ media_id: "media-old" }]);
    expect(database.prepare("SELECT media_id FROM wiki_revision_media WHERE revision_id = 'revision-3'").get())
      .toMatchObject({ media_id: "media-old" });
    expect(database.prepare("SELECT state FROM media_assets WHERE id = 'media-new'").get())
      .toMatchObject({ state: "attached" });
    expect(database.prepare("SELECT count(*) AS count FROM audit_log").get()).toMatchObject({ count: 3 });
  });

  it("rolls the whole mutation back when any snapshot statement fails", async () => {
    const { database, store } = harness();
    const initial = article();
    await store.createArticle({
      record: initial,
      initialRevision: revision(initial),
      mediaIds: [],
      audit: { ...audit("audit-create"), action: "create" },
    });
    const changed = article({ title: "Must roll back", revisionToken: "article-revision-2", currentRevision: 2 });

    await expect(store.mutateArticle({
      record: changed,
      expectedRevisionToken: initial.revisionToken,
      revision: revision(changed, "revision-1"),
      mediaIds: [],
      audit: audit("audit-failed"),
    })).rejects.toThrow();
    expect(database.prepare("SELECT title, current_revision FROM wiki_articles WHERE id = 'article-1'").get())
      .toEqual({ title: "Guide", current_revision: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM audit_log WHERE id = 'audit-failed'").get())
      .toMatchObject({ count: 0 });
  });

  it("keeps 50 revision and current-media links bounded and rolls every snapshot effect back on audit failure", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => wikiMediaId(index));
    const maximum = article({ mediaIds: ids });

    const success = harness();
    ids.forEach((id) => seedMedia(success.database, id));
    await success.store.createArticle({
      record: maximum,
      initialRevision: revision(maximum),
      mediaIds: ids,
      audit: { ...audit("audit-max-success"), action: "create" },
    });
    expect(success.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    const currentMedia = success.database.prepare(`SELECT media_id FROM media_links
      WHERE entity_type = 'wiki_article' AND entity_id = 'article-1' ORDER BY sort_order`).all() as Array<{ media_id: string }>;
    const revisionMedia = success.database.prepare(`SELECT media_id FROM wiki_revision_media
      WHERE revision_id = 'revision-1' ORDER BY sort_order`).all() as Array<{ media_id: string }>;
    expect(currentMedia.map(({ media_id }) => media_id)).toEqual(ids);
    expect(revisionMedia.map(({ media_id }) => media_id)).toEqual(ids);

    const failed = harness();
    ids.forEach((id) => seedMedia(failed.database, id));
    const rejectedAudit = { ...audit("audit-max-failed"), action: "create" as const };
    failed.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      rejectedAudit.eventId,
      rejectedAudit.requestId,
      rejectedAudit.actorKind,
      rejectedAudit.actorId,
      rejectedAudit.actorLabel,
      rejectedAudit.subjectType,
      rejectedAudit.subjectId,
      rejectedAudit.subjectLabel,
      rejectedAudit.action,
      JSON.stringify(rejectedAudit.payload),
      rejectedAudit.occurredAt,
    );
    await expect(failed.store.createArticle({
      record: maximum,
      initialRevision: revision(maximum),
      mediaIds: ids,
      audit: rejectedAudit,
    })).rejects.toThrow(/UNIQUE/i);
    expect(failed.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(failed.database.prepare("SELECT count(*) AS count FROM wiki_articles").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM wiki_revisions").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM wiki_revision_media").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_links").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'staged'").get())
      .toMatchObject({ count: 50 });
  });

  it("keeps all 151 revisions while list pages remain bounded to 50", async () => {
    const { database, store } = harness();
    let current = article();
    await store.createArticle({
      record: current,
      initialRevision: revision(current),
      mediaIds: [],
      audit: { ...audit("audit-1"), action: "create" },
    });
    for (let number = 2; number <= 151; number += 1) {
      const next = article({
        title: `Guide ${number}`,
        updated_by: "user-1",
        updated_at: new Date(Date.parse(NOW) + number).toISOString(),
        revisionToken: `article-revision-${number}`,
        currentRevision: number,
      });
      await store.mutateArticle({
        record: next,
        expectedRevisionToken: current.revisionToken,
        revision: revision(next),
        mediaIds: [],
        audit: audit(`audit-${number}`),
      });
      current = next;
      if (number === 51) {
        expect(database.prepare("SELECT count(*) AS count FROM wiki_revisions").get()).toMatchObject({ count: 51 });
        const pageAt51 = await store.listRevisions("article-1", { limit: 50 });
        expect(pageAt51).toHaveLength(50);
        expect(pageAt51[0]?.revision).toBe(51);
      }
    }

    expect(database.prepare("SELECT count(*) AS count FROM wiki_revisions").get()).toMatchObject({ count: 151 });
    const first = await store.listRevisions("article-1", { limit: 50 });
    const second = await store.listRevisions("article-1", { beforeRevision: first.at(-1)!.revision, limit: 50 });
    expect(first).toHaveLength(50);
    expect(first[0]?.revision).toBe(151);
    expect(second[0]?.revision).toBe(101);
  });

  it("rejects ordinary revision UPDATE and DELETE and physical article DELETE", async () => {
    const { database, store } = harness();
    const initial = article();
    await store.createArticle({
      record: initial,
      initialRevision: revision(initial),
      mediaIds: [],
      audit: { ...audit("audit-create"), action: "create" },
    });

    expect(() => database.prepare("UPDATE wiki_revisions SET title = 'forged' WHERE id = 'revision-1'").run())
      .toThrow(/immutable/i);
    expect(() => database.prepare("DELETE FROM wiki_revisions WHERE id = 'revision-1'").run())
      .toThrow(/immutable/i);
    expect(() => database.prepare("DELETE FROM wiki_articles WHERE id = 'article-1'").run())
      .toThrow(/tombstone/i);
  });
});

describe("SqliteWikiStore query plans", () => {
  it("lets a create-only author read public and owned archived articles, never another author's", async () => {
    const { store } = harness();
    const records = [
      article({ id: "public-other", slug: "public-other", created_by: "user-2", revisionToken: "revision-public-other" }),
      article({ id: "archived-own", slug: "archived-own", archived_at: NOW, revisionToken: "revision-archived-own" }),
      article({ id: "archived-other", slug: "archived-other", archived_at: NOW, created_by: "user-2", revisionToken: "revision-archived-other" }),
    ];
    for (const record of records) {
      await store.createArticle({
        record,
        initialRevision: revision(record, `snapshot-${record.id}`),
        mediaIds: [],
        audit: { ...audit(`audit-${record.id}`), subjectId: record.id, action: "create" },
      });
    }

    const owned = await store.listArticles({
      page: 1,
      limit: 20,
      categoryIds: [],
      sort: "curated",
      readScope: OWNED_SCOPE,
    });
    expect(new Set(owned.data.map(({ id }) => id))).toEqual(new Set(["public-other", "archived-own"]));
    await expect(store.getArticleBySlug("public-other", OWNED_SCOPE)).resolves.not.toBeNull();
    await expect(store.getArticleBySlug("archived-own", OWNED_SCOPE)).resolves.not.toBeNull();
    await expect(store.getArticleBySlug("archived-other", OWNED_SCOPE)).resolves.toBeNull();
    await expect(store.incrementArticleView("public-other", OWNED_SCOPE)).resolves.toBe(1);
    await expect(store.incrementArticleView("archived-own", OWNED_SCOPE)).resolves.toBe(1);
    await expect(store.incrementArticleView("archived-other", OWNED_SCOPE)).resolves.toBeNull();
    const ownedArchived = await store.listArticles({
      page: 1,
      limit: 20,
      categoryIds: [],
      archived: true,
      sort: "curated",
      readScope: OWNED_SCOPE,
    });
    expect(ownedArchived.data.map(({ id }) => id)).toEqual(["archived-own"]);

    const publicPage = await store.listArticles({
      page: 1,
      limit: 20,
      categoryIds: [],
      sort: "curated",
      readScope: PUBLIC_SCOPE,
    });
    expect(publicPage.data.map(({ id }) => id)).toEqual(["public-other"]);
    const managedPage = await store.listArticles({
      page: 1,
      limit: 20,
      categoryIds: [],
      sort: "curated",
      readScope: ALL_SCOPE,
    });
    expect(managedPage.total).toBe(3);
  });

  it("derives bounded excerpts and searches the canonical body text", async () => {
    const { store } = harness();
    const bodyText = `Dragon tactics ${"x".repeat(300)}`;
    const record = article({
      body_json: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
      }),
      excerpt: "stale client value",
    });
    await store.createArticle({
      record,
      initialRevision: revision(record),
      mediaIds: [],
      audit: { ...audit("audit-search"), action: "create" },
    });

    const page = await store.listArticles({
      page: 1,
      limit: 20,
      categoryIds: [],
      search: "dragon",
      sort: "curated",
      readScope: PUBLIC_SCOPE,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.excerpt).toBe(bodyText.slice(0, 280));
    expect((await store.getArticleBySlug("guide", PUBLIC_SCOPE))?.excerpt).toBe(bodyText.slice(0, 280));
  });

  it("uses management indexes when archived articles are included", async () => {
    const { database, executor, store } = harness();
    const variants = [
      ["curated", "idx_wiki_articles_admin_curated"],
      ["updated_desc", "idx_wiki_articles_admin_updated"],
      ["updated_asc", "idx_wiki_articles_admin_updated"],
    ] as const;
    for (const [sort, indexName] of variants) {
      await store.listArticles({ page: 1, limit: 50, categoryIds: [], sort, readScope: ALL_SCOPE });
      const statement = executor.batches.at(-1)?.[1];
      if (!statement) throw new Error(`Missing Wiki ${sort} list statement`);
      const detail = queryPlan(database, statement);
      expect(detail).toContain(indexName);
      expect(detail).not.toContain("USE TEMP B-TREE");
    }
  });
});

function queryPlan(database: DatabaseSync, statement: SqlStatement): string {
  const params = [...(statement.params ?? [])] as SQLInputValue[];
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map(({ detail }) => detail).join("\n");
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA recursive_triggers = ON;
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  );
  CREATE TABLE media_assets (
    id TEXT PRIMARY KEY, owner_user_id TEXT, purpose TEXT NOT NULL, original_name TEXT,
    media_type TEXT NOT NULL,
    state TEXT NOT NULL, expires_at TEXT, delete_claim_token TEXT, delete_claim_until TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_media_assets_gc ON media_assets(state, expires_at, delete_claim_until, id);
  CREATE INDEX idx_media_assets_gc_deleting ON media_assets(state, delete_claim_until, updated_at, id);
  CREATE TABLE media_variants (
    media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    variant TEXT NOT NULL, object_key TEXT NOT NULL,
    byte_size INTEGER NOT NULL DEFAULT 1,
    content_type TEXT NOT NULL DEFAULT 'image/webp',
    sha256 TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    PRIMARY KEY(media_id, variant)
  );
  CREATE TABLE media_links (
    media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, slot TEXT NOT NULL, audience TEXT NOT NULL,
    sort_order INTEGER NOT NULL, attached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(entity_type, entity_id, slot, media_id),
    UNIQUE(entity_type, entity_id, slot, sort_order)
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
    actor_label TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_label TEXT,
    action TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
  );
  CREATE TABLE system_test_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
  CREATE TABLE system_test_artifacts (
    run_id TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_key TEXT NOT NULL,
    PRIMARY KEY(run_id, artifact_type, artifact_key)
  );
  CREATE TABLE announcements (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, publish_at TEXT NOT NULL, expires_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id)
  );
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    visible_at TEXT,
    archived_at TEXT
  );
  CREATE TABLE wiki_category_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision_token TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE wiki_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT REFERENCES wiki_categories(id), revision_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE wiki_articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL REFERENCES wiki_categories(id), body_json TEXT NOT NULL,
    sort_order INTEGER NOT NULL, pinned INTEGER NOT NULL, archived_at TEXT, deleted_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT REFERENCES users(id),
    current_revision INTEGER NOT NULL, revision_token TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '', view_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_wiki_articles_admin_curated
    ON wiki_articles(deleted_at, pinned DESC, sort_order, title, id);
  CREATE INDEX idx_wiki_articles_admin_updated
    ON wiki_articles(deleted_at, updated_at, id);
  CREATE TABLE wiki_revisions (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES wiki_articles(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, category_id TEXT NOT NULL,
    body_json TEXT NOT NULL, sort_order INTEGER NOT NULL, pinned INTEGER NOT NULL,
    archived_at TEXT, deleted_at TEXT, edited_by TEXT NOT NULL REFERENCES users(id),
    restored_from INTEGER, created_at TEXT NOT NULL, UNIQUE(article_id, revision)
  );
  CREATE TABLE wiki_revision_media (
    revision_id TEXT NOT NULL REFERENCES wiki_revisions(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    audience TEXT NOT NULL, sort_order INTEGER NOT NULL,
    PRIMARY KEY(revision_id, media_id), UNIQUE(revision_id, sort_order)
  );
`;
