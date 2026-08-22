import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import { LIMITS } from "@guild/shared/config/limits";
import { createAppDatabase } from "../database.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteMembersStore } from "./members-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const REORDERED_AT = "2026-08-09T13:00:00.000Z";
const BASE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE roles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, level INTEGER NOT NULL, color TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL CHECK(is_active IN (0, 1)), deleted_at TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE INDEX idx_users_roster ON users(deleted_at, is_active, created_at, id);
  CREATE INDEX idx_users_roster_all ON users(deleted_at, created_at, id);
  CREATE TABLE member_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, power REAL NOT NULL DEFAULT 0,
    title_html TEXT, bio TEXT, availability_timezone TEXT, notes TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE class_catalog (
    id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, color TEXT NOT NULL, icon_type TEXT NOT NULL,
    vector_icon TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_class_catalog_sort ON class_catalog(sort_order, id);
  CREATE TABLE class_tags (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, sort_order INTEGER NOT NULL, owner_kind TEXT, owner_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE class_tag_members (
    tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES class_catalog(id), PRIMARY KEY(tag_id, class_id)
  );
  CREATE TABLE member_profile_classes (
    user_id TEXT NOT NULL REFERENCES member_profiles(user_id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES class_catalog(id), sort_order INTEGER NOT NULL,
    PRIMARY KEY(user_id, class_id), UNIQUE(user_id, sort_order)
  );
  CREATE INDEX idx_member_profile_classes_class ON member_profile_classes(class_id, user_id);
  CREATE TABLE member_profile_videos (
    user_id TEXT NOT NULL REFERENCES member_profiles(user_id) ON DELETE CASCADE,
    url TEXT NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY(user_id, url), UNIQUE(user_id, sort_order)
  );
  CREATE TABLE member_availability_windows (
    user_id TEXT NOT NULL REFERENCES member_profiles(user_id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL, start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL,
    PRIMARY KEY(user_id, weekday, start_minute, end_minute)
  );
  CREATE TABLE member_absences (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX idx_member_absences_user_start ON member_absences(user_id, start_date, id);
  CREATE INDEX idx_member_absences_window ON member_absences(end_date, start_date, user_id);
  CREATE TABLE member_badges (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, label_html TEXT NOT NULL, color TEXT NOT NULL,
    description TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_member_badges_sort ON member_badges(sort_order, id);
  CREATE TABLE member_badge_assignments (
    badge_id TEXT NOT NULL REFERENCES member_badges(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL REFERENCES users(id), assigned_at TEXT NOT NULL,
    PRIMARY KEY(badge_id, user_id)
  );
  CREATE INDEX idx_member_badge_assignments_user ON member_badge_assignments(user_id, badge_id);
  CREATE TABLE media_links (
    media_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, slot TEXT NOT NULL,
    audience TEXT NOT NULL, sort_order INTEGER NOT NULL, attached_at TEXT NOT NULL DEFAULT '${NOW}',
    PRIMARY KEY(entity_type, entity_id, slot, media_id),
    UNIQUE(entity_type, entity_id, slot, sort_order)
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
    actor_label TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_label TEXT,
    action TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
  );
  CREATE TABLE system_test_runs (id TEXT PRIMARY KEY);
  CREATE TABLE system_test_requests (
    request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES system_test_runs(id),
    actor_user_id TEXT, started_at TEXT NOT NULL
  );
  CREATE TABLE system_test_artifacts (
    run_id TEXT NOT NULL REFERENCES system_test_runs(id), artifact_type TEXT NOT NULL,
    artifact_key TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, artifact_type, artifact_key)
  );
  CREATE TABLE system_test_before_images (
    run_id TEXT NOT NULL REFERENCES system_test_runs(id), target_type TEXT NOT NULL,
    target_id TEXT NOT NULL, before_sort_order INTEGER NOT NULL, before_updated_at TEXT NOT NULL,
    expected_sort_order INTEGER NOT NULL, expected_updated_at TEXT NOT NULL,
    request_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, target_type, target_id)
  );
`;

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(BASE_SCHEMA);
  database.prepare("INSERT INTO roles (id, name, level, color, revision_token, created_at, updated_at) VALUES ('admin', 'Admin', 900, NULL, 'admin-v1', ?, ?)").run(NOW, NOW);
  database.prepare("INSERT INTO roles (id, name, level, color, revision_token, created_at, updated_at) VALUES ('member', 'Member', 100, NULL, 'member-v1', ?, ?)").run(NOW, NOW);
  insertUser(database, "admin-1", "Admin", "admin", true, null);
  insertUser(database, "target-1", "Target", "member", true, null);
  insertUser(database, "inactive-1", "Inactive", "member", false, null);
  insertUser(database, "deleted-1", "Deleted", "member", false, NOW);
  database.prepare("INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order) VALUES (?, 'member_profile', 'target-1', 'image', 'public', ?)").run("media-a", 0);
  database.prepare("INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order) VALUES (?, 'member_profile', 'target-1', 'image', 'public', ?)").run("media-b", 1);
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteMembersStore(createAppDatabase(executor), executor) };
}

function insertUser(database: DatabaseSync, id: string, username: string, roleId: string, active: boolean, deletedAt: string | null): void {
  database.prepare(`INSERT INTO users (
    id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, username, roleId, active ? 1 : 0, deletedAt, `${id}-v1`, NOW, NOW);
  database.prepare("INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at) VALUES (?, 0, ?, ?, ?)")
    .run(id, `${id}-profile-v1`, NOW, NOW);
}

function context(requestId: string = crypto.randomUUID()) {
  return createRequestContext({
    requestId, now: NOW,
    authorization: createAuthorizationContext({
      userId: "admin-1", sessionId: "session", roleId: "admin", roleLevel: 900,
      permissions: ["admin.users.edit", "admin.users.view", "admin.badges.manage"],
    }),
  });
}

function audit(
  entityType: "member_profile" | "member_absence" | "member_badge" | "class_catalog" | "class_tag",
  entityId: string,
  action: "update" | "create" | "assign" | "unassign",
  requestId?: string,
) {
  return createAuditEvent(context(requestId), {
    subjectType: entityType,
    subjectId: entityId,
    subjectLabel: null,
    action,
    context: [],
  });
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function text(database: DatabaseSync, sql: string): string | null {
  const row = database.prepare(sql).get() as Record<string, string | null>;
  return Object.values(row)[0] ?? null;
}

function auditUserIds(database: DatabaseSync, requestId: string): readonly string[] {
  return auditUserReferences(database, requestId).map(({ id }) => id);
}

function auditUserReferences(database: DatabaseSync, requestId: string): readonly Readonly<{ id: string; label: string }>[] {
  const payload = JSON.parse(text(database, `SELECT payload_json FROM audit_log WHERE request_id = '${requestId}'`)!) as {
    context: readonly [{ value: { value: readonly { value: { id: string; label: string } }[] } }];
  };
  return payload.context[0].value.value.map((entry) => entry.value);
}

describe("SqliteMembersStore catalog singleton reads", () => {
  it("uses one bounded id query per class, catalog tag, and badge without calling list methods", async () => {
    const value = harness();
    const insertClass = value.database.prepare(`INSERT INTO class_catalog (
      id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
    ) VALUES (?, ?, '#fff', ?, ?, ?, ?, ?)`);
    insertClass.run("class-other", "Other", "vector", "sword", 0, NOW, NOW);
    insertClass.run("class-target", "Target Class", "image", null, 10, NOW, NOW);
    value.database.prepare(`INSERT INTO class_tags (
      id, label, sort_order, owner_kind, owner_id, created_at, updated_at
    ) VALUES ('tag-target', 'Target Tag', 0, NULL, NULL, ?, ?)`).run(NOW, NOW);
    value.database.prepare("INSERT INTO class_tag_members (tag_id, class_id) VALUES ('tag-target', 'class-target')").run();
    value.database.prepare("INSERT INTO class_tag_members (tag_id, class_id) VALUES ('tag-target', 'class-other')").run();
    value.database.prepare(`INSERT INTO member_badges (
      id, name, label_html, color, description, sort_order, created_at, updated_at
    ) VALUES ('badge-target', 'Target Badge', '<b>Target</b>', '#fff', 'Direct read', 0, ?, ?)`).run(NOW, NOW);
    const listClasses = vi.spyOn(value.store, "listClasses").mockRejectedValue(new Error("must not list classes"));
    const listClassTags = vi.spyOn(value.store, "listClassTags").mockRejectedValue(new Error("must not list tags"));
    const listBadges = vi.spyOn(value.store, "listBadges").mockRejectedValue(new Error("must not list badges"));
    const before = value.executor.statements.length;

    await expect(value.store.findClass("class-target")).resolves.toMatchObject({
      id: "class-target",
      icon_type: "image",
      vector_icon: null,
    });
    await expect(value.store.findClassTag("tag-target")).resolves.toMatchObject({
      id: "tag-target",
      class_ids: ["class-other", "class-target"],
    });
    await expect(value.store.findBadge("badge-target")).resolves.toMatchObject({
      id: "badge-target",
      description: "Direct read",
    });

    expect(listClasses).not.toHaveBeenCalled();
    expect(listClassTags).not.toHaveBeenCalled();
    expect(listBadges).not.toHaveBeenCalled();
    const reads = value.executor.statements.slice(before);
    expect(reads).toHaveLength(3);
    expect(reads.every(({ sql }) => /\blimit \?/i.test(sql))).toBe(true);
  });
});

describe("SqliteMembersStore atomic profile writes", () => {
  it("commits profile children, media order, and audit in one batch", async () => {
    const value = harness();
    const target = await value.store.getMemberTarget("target-1");
    const updated = await value.store.updateProfile("target-1", {
      bio: "next", classes: [], videoUrls: ["https://example.com/video"], images: ["media-b"], updatedAt: NOW,
    }, target!, ["media-a", "media-b"], audit("member_profile", "target-1", "update"));

    expect(updated?.bio).toBe("next");
    expect(text(value.database, "SELECT media_id FROM media_links WHERE entity_id = 'target-1'")).toBe("media-b");
    expect(scalar(value.database, "SELECT count(*) FROM member_profile_videos WHERE user_id = 'target-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(1);
    expect(value.executor.batches).toHaveLength(1);
  });

  it("returns conflict with no profile, media, or audit change after a target-role race", async () => {
    const value = harness();
    const target = await value.store.getMemberTarget("target-1");
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE roles SET level = 950, revision_token = 'raced' WHERE id = 'member'").run();
    };
    const updated = await value.store.updateProfile("target-1", {
      bio: "blocked", images: ["media-b", "media-a"], updatedAt: NOW,
    }, target!, ["media-a", "media-b"], audit("member_profile", "target-1", "update"));
    expect(updated).toBeNull();
    expect(text(value.database, "SELECT bio FROM member_profiles WHERE user_id = 'target-1'")).toBeNull();
    expect(text(value.database, "SELECT group_concat(media_id, ',') FROM (SELECT media_id FROM media_links WHERE entity_id = 'target-1' ORDER BY sort_order)")).toBe("media-a,media-b");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("rolls back the profile and its early audit when a child row fails", async () => {
    const value = harness();
    const target = await value.store.getMemberTarget("target-1");
    await expect(value.store.updateProfile("target-1", {
      bio: "blocked", classes: ["missing-class"], images: ["media-b"], updatedAt: NOW,
    }, target!, ["media-a", "media-b"], audit("member_profile", "target-1", "update"))).rejects.toThrow(/FOREIGN KEY/);
    expect(text(value.database, "SELECT bio FROM member_profiles WHERE user_id = 'target-1'")).toBeNull();
    expect(text(value.database, "SELECT group_concat(media_id, ',') FROM (SELECT media_id FROM media_links WHERE entity_id = 'target-1' ORDER BY sort_order)")).toBe("media-a,media-b");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });
});

describe("SqliteMembersStore system-test reorder snapshots", () => {
  it("captures existing class, tag, and badge order in the same mutation batch", async () => {
    const value = harness();
    const requestId = "system-request";
    value.database.prepare("INSERT INTO system_test_runs (id) VALUES ('run-1')").run();
    value.database.prepare(`INSERT INTO system_test_requests (request_id, run_id, actor_user_id, started_at)
      VALUES (?, 'run-1', 'admin-1', ?)`).run(requestId, NOW);
    const insertClass = value.database.prepare(`INSERT INTO class_catalog (
      id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
    ) VALUES (?, ?, '#fff', 'vector', 'sword', ?, ?, ?)`);
    insertClass.run("class-a", "Class A", 100, NOW, NOW);
    insertClass.run("class-b", "Class B", 200, NOW, NOW);
    value.database.prepare(`INSERT INTO system_test_artifacts (
      run_id, artifact_type, artifact_key, request_id, created_at
    ) VALUES ('run-1', 'class_catalog', 'class-b', ?, ?)`).run(requestId, NOW);
    const insertTag = value.database.prepare(`INSERT INTO class_tags (
      id, label, sort_order, owner_kind, owner_id, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?)`);
    insertTag.run("tag-a", "Tag A", 300, NOW, NOW);
    insertTag.run("tag-b", "Tag B", 400, NOW, NOW);
    const insertBadge = value.database.prepare(`INSERT INTO member_badges (
      id, name, label_html, color, description, sort_order, created_at, updated_at
    ) VALUES (?, ?, 'label', '#fff', NULL, ?, ?, ?)`);
    insertBadge.run("badge-a", "Badge A", 500, NOW, NOW);
    insertBadge.run("badge-b", "Badge B", 600, NOW, NOW);

    await value.store.reorderClasses(["class-b", "class-a"], REORDERED_AT, audit("class_catalog", "catalog", "update", requestId));
    await value.store.reorderClassTags(["tag-b", "tag-a"], REORDERED_AT, audit("class_tag", "catalog", "update", requestId));
    await value.store.reorderBadges(["badge-b", "badge-a"], REORDERED_AT, audit("member_badge", "catalog", "update", requestId));

    expect(value.database.prepare(`SELECT target_type, target_id, before_sort_order, expected_sort_order,
      before_updated_at, expected_updated_at FROM system_test_before_images
      ORDER BY target_type, target_id`).all()).toEqual([
      { target_type: "badge", target_id: "badge-a", before_sort_order: 500, expected_sort_order: 10, before_updated_at: NOW, expected_updated_at: REORDERED_AT },
      { target_type: "badge", target_id: "badge-b", before_sort_order: 600, expected_sort_order: 0, before_updated_at: NOW, expected_updated_at: REORDERED_AT },
      { target_type: "class_catalog", target_id: "class-a", before_sort_order: 100, expected_sort_order: 10, before_updated_at: NOW, expected_updated_at: REORDERED_AT },
      { target_type: "class_tag", target_id: "tag-a", before_sort_order: 300, expected_sort_order: 10, before_updated_at: NOW, expected_updated_at: REORDERED_AT },
      { target_type: "class_tag", target_id: "tag-b", before_sort_order: 400, expected_sort_order: 0, before_updated_at: NOW, expected_updated_at: REORDERED_AT },
    ]);
    expect(value.executor.batches.slice(-3).every((batch) => batch[0]?.sql.includes("system_test_before_images"))).toBe(true);
  });

  it("rolls a before-image update back when the reorder audit fails", async () => {
    const value = harness();
    const requestId = "system-request";
    value.database.prepare("INSERT INTO system_test_runs (id) VALUES ('run-1')").run();
    value.database.prepare(`INSERT INTO system_test_requests (request_id, run_id, actor_user_id, started_at)
      VALUES (?, 'run-1', 'admin-1', ?)`).run(requestId, NOW);
    const insertClass = value.database.prepare(`INSERT INTO class_catalog (
      id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
    ) VALUES (?, ?, '#fff', 'vector', 'sword', ?, ?, ?)`);
    insertClass.run("class-a", "Class A", 100, NOW, NOW);
    insertClass.run("class-b", "Class B", 200, NOW, NOW);
    const mutation = audit("class_catalog", "catalog", "update", requestId);
    value.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(mutation.eventId, mutation.requestId, mutation.actorKind, mutation.actorId, mutation.actorLabel,
        mutation.subjectType, mutation.subjectId, mutation.subjectLabel, mutation.action,
        JSON.stringify(mutation.payload), mutation.occurredAt);

    await expect(value.store.reorderClasses(["class-b", "class-a"], REORDERED_AT, mutation)).rejects.toThrow(/UNIQUE/);
    expect(value.database.prepare("SELECT id, sort_order, updated_at FROM class_catalog ORDER BY id").all()).toEqual([
      { id: "class-a", sort_order: 100, updated_at: NOW },
      { id: "class-b", sort_order: 200, updated_at: NOW },
    ]);
    expect(value.database.prepare("SELECT count(*) AS count FROM system_test_before_images").get()).toMatchObject({ count: 0 });
  });
});

describe("SqliteMembersStore no-op catalog mutations", () => {
  it("keeps class-tag and badge timestamps stable and audits only real field changes", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO class_catalog (
      id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
    ) VALUES (?, ?, '#fff', 'vector', 'sword', ?, ?, ?)`).run("class-a", "Class A", 0, NOW, NOW);
    value.database.prepare(`INSERT INTO class_catalog (
      id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
    ) VALUES (?, ?, '#fff', 'vector', 'sword', ?, ?, ?)`).run("class-b", "Class B", 10, NOW, NOW);
    value.database.prepare(`INSERT INTO class_tags (
      id, label, sort_order, owner_kind, owner_id, created_at, updated_at
    ) VALUES ('tag-1', 'Support', 0, NULL, NULL, ?, ?)`).run(NOW, NOW);
    value.database.prepare("INSERT INTO class_tag_members (tag_id, class_id) VALUES ('tag-1', ?)").run("class-a");
    value.database.prepare("INSERT INTO class_tag_members (tag_id, class_id) VALUES ('tag-1', ?)").run("class-b");
    value.database.prepare(`INSERT INTO member_badges (
      id, name, label_html, color, description, sort_order, created_at, updated_at
    ) VALUES ('badge-1', 'Veteran', '<b>Veteran</b>', '#fff', NULL, 0, ?, ?)`).run(NOW, NOW);

    await value.store.updateClassTag("tag-1", {
      label: "Support", classIds: ["class-b", "class-a"], sortOrder: 0, now: REORDERED_AT,
    }, audit("class_tag", "tag-1", "update", "tag-no-op"));
    await value.store.updateBadge("badge-1", {
      name: "Veteran", labelHtml: "<b>Veteran</b>", color: "#fff", description: null,
      sortOrder: 0, now: REORDERED_AT,
    }, audit("member_badge", "badge-1", "update", "badge-no-op"));

    expect(text(value.database, "SELECT updated_at FROM class_tags WHERE id = 'tag-1'")).toBe(NOW);
    expect(text(value.database, "SELECT updated_at FROM member_badges WHERE id = 'badge-1'")).toBe(NOW);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);

    await value.store.updateClassTag("tag-1", {
      label: "Frontline", now: REORDERED_AT,
    }, audit("class_tag", "tag-1", "update", "tag-change"));
    await value.store.updateBadge("badge-1", {
      color: "#000", now: REORDERED_AT,
    }, audit("member_badge", "badge-1", "update", "badge-change"));

    expect(text(value.database, "SELECT updated_at FROM class_tags WHERE id = 'tag-1'")).toBe(REORDERED_AT);
    expect(text(value.database, "SELECT updated_at FROM member_badges WHERE id = 'badge-1'")).toBe(REORDERED_AT);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(2);
  });

  it("updates timestamps only for catalog rows whose positions changed", async () => {
    const value = harness();
    const insertTag = value.database.prepare(`INSERT INTO class_tags (
      id, label, sort_order, owner_kind, owner_id, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?)`);
    const insertBadge = value.database.prepare(`INSERT INTO member_badges (
      id, name, label_html, color, description, sort_order, created_at, updated_at
    ) VALUES (?, ?, 'label', '#fff', NULL, ?, ?, ?)`);
    for (const [index, id] of ["a", "b", "c"].entries()) {
      insertTag.run(`tag-${id}`, `Tag ${id}`, index * 10, NOW, NOW);
      insertBadge.run(`badge-${id}`, `Badge ${id}`, index * 10, NOW, NOW);
    }

    await value.store.reorderClassTags(["tag-a", "tag-b", "tag-c"], REORDERED_AT, audit("class_tag", "catalog", "update", "tag-order-no-op"));
    await value.store.reorderBadges(["badge-a", "badge-b", "badge-c"], REORDERED_AT, audit("member_badge", "catalog", "update", "badge-order-no-op"));
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
    expect(scalar(value.database, `SELECT count(*) FROM class_tags WHERE updated_at = '${NOW}'`)).toBe(3);
    expect(scalar(value.database, `SELECT count(*) FROM member_badges WHERE updated_at = '${NOW}'`)).toBe(3);

    await value.store.reorderClassTags(["tag-b", "tag-a", "tag-c"], REORDERED_AT, audit("class_tag", "catalog", "update", "tag-order-change"));
    await value.store.reorderBadges(["badge-b", "badge-a", "badge-c"], REORDERED_AT, audit("member_badge", "catalog", "update", "badge-order-change"));
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(2);
    expect(text(value.database, "SELECT updated_at FROM class_tags WHERE id = 'tag-c'")).toBe(NOW);
    expect(text(value.database, "SELECT updated_at FROM member_badges WHERE id = 'badge-c'")).toBe(NOW);
    expect(scalar(value.database, `SELECT count(*) FROM class_tags WHERE updated_at = '${REORDERED_AT}'`)).toBe(2);
    expect(scalar(value.database, `SELECT count(*) FROM member_badges WHERE updated_at = '${REORDERED_AT}'`)).toBe(2);
  });
});

describe("SqliteMembersStore visibility and hard limits", () => {
  it("shows members only active, non-deleted absences while admin policy includes inactive but not deleted", async () => {
    const value = harness();
    const insert = value.database.prepare("INSERT INTO member_absences (id, user_id, start_date, end_date, note, created_at) VALUES (?, ?, '2026-08-10', '2026-08-11', ?, ?)");
    insert.run("absence-active", "target-1", "active note", NOW);
    insert.run("absence-inactive", "inactive-1", "inactive note", NOW);
    insert.run("absence-deleted", "deleted-1", "deleted note", NOW);

    const memberRows = await value.store.listAbsences({ viewerUserId: "target-1", projection: "member" });
    expect(memberRows.map(({ id }) => id)).toEqual(["absence-active"]);
    expect(memberRows[0]?.note).toBe("active note");
    const adminRows = await value.store.listAbsences({ viewerUserId: "admin-1", projection: "admin" });
    expect(new Set(adminRows.map(({ id }) => id))).toEqual(new Set(["absence-active", "absence-inactive"]));
    expect(adminRows.find(({ id }) => id === "absence-inactive")?.note).toBe("inactive note");
  });

  it("enforces the absence count in the insert transaction without audit", async () => {
    const value = harness();
    value.database.prepare("INSERT INTO member_absences (id, user_id, start_date, end_date, note, created_at) VALUES ('existing', 'target-1', '2026-08-10', '2026-08-11', NULL, ?)").run(NOW);
    const created = await value.store.createAbsence({
      id: "overflow", userId: "target-1", startDate: "2026-09-01", endDate: "2026-09-02",
      note: null, maximumEntries: 1, now: NOW,
    }, audit("member_absence", "overflow", "create"));
    expect(created).toBeNull();
    expect(scalar(value.database, "SELECT count(*) FROM member_absences WHERE user_id = 'target-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("rejects an absence result set above the hard limit instead of truncating it", async () => {
    const value = harness();
    const insert = value.database.prepare(`INSERT INTO member_absences (
      id, user_id, start_date, end_date, note, created_at
    ) VALUES (?, 'target-1', '2026-08-10', '2026-08-11', NULL, ?)`);
    for (let index = 0; index <= LIMITS.content.absenceQueryResults.max; index += 1) {
      insert.run(`absence-${index}`, NOW);
    }

    await expect(value.store.listAbsences({
      from: "2026-08-01", to: "2026-08-31", viewerUserId: "admin-1", projection: "admin",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("switches an image class to a vector and removes its link with the same audit batch", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO class_catalog (
      id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
    ) VALUES ('class-1', 'Class', '#fff', 'image', NULL, 0, ?, ?)`).run(NOW, NOW);
    value.database.prepare(`INSERT INTO media_links (
      media_id, entity_type, entity_id, slot, audience, sort_order
    ) VALUES ('class-media', 'class_catalog', 'class-1', 'icon', 'public', 0)`).run();

    await expect(value.store.updateClass(
      "class-1", { vectorIcon: "sword", now: NOW }, audit("class_catalog", "class-1", "update"),
    )).resolves.toBe("updated");
    expect(text(value.database, "SELECT icon_type FROM class_catalog WHERE id = 'class-1'")).toBe("vector");
    expect(text(value.database, "SELECT vector_icon FROM class_catalog WHERE id = 'class-1'")).toBe("sword");
    expect(scalar(value.database, "SELECT count(*) FROM media_links WHERE entity_id = 'class-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'class-1'")).toBe(1);
    expect(value.executor.batches).toHaveLength(1);
  });

  it("splits one hundred badge ids into parameter-safe statements inside one atomic batch", async () => {
    const value = harness();
    value.database.prepare("INSERT INTO member_badges (id, name, label_html, color, description, sort_order, created_at, updated_at) VALUES ('badge', 'Badge', '<b>B</b>', '#fff', NULL, 0, ?, ?)").run(NOW, NOW);
    const insertAssignment = value.database.prepare("INSERT INTO member_badge_assignments (badge_id, user_id, assigned_by, assigned_at) VALUES ('badge', ?, 'admin-1', ?)");
    const ids = Array.from({ length: 100 }, (_, index) => `bulk-${index}`);
    for (const [index, id] of ids.entries()) {
      insertUser(value.database, id, `Bulk ${index}`, "member", true, null);
      insertAssignment.run(id, NOW);
    }
    const removed = await value.store.unassignBadge("badge", ids, audit("member_badge", "badge", "unassign"));
    expect(removed).toBe(100);
    expect(scalar(value.database, "SELECT count(*) FROM member_badge_assignments")).toBe(0);
    expect(value.executor.batches).toHaveLength(1);
    expect(Math.max(...value.executor.batches[0]!.map(({ params }) => params?.length ?? 0))).toBeLessThanOrEqual(100);
  });

  it("does not audit duplicate badge assignments or repeated removals", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO member_badges (
      id, name, label_html, color, description, sort_order, created_at, updated_at
    ) VALUES ('badge-no-op', 'No-op Badge', '<b>No-op</b>', '#fff', NULL, 0, ?, ?)`).run(NOW, NOW);

    await expect(value.store.assignBadge(
      "badge-no-op",
      ["target-1"],
      "admin-1",
      NOW,
      audit("member_badge", "badge-no-op", "assign", "assign-first"),
    )).resolves.toBe(1);
    await expect(value.store.assignBadge(
      "badge-no-op",
      ["target-1"],
      "admin-1",
      NOW,
      audit("member_badge", "badge-no-op", "assign", "assign-duplicate"),
    )).resolves.toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE action = 'assign'")).toBe(1);

    await expect(value.store.unassignBadge(
      "badge-no-op",
      ["target-1"],
      audit("member_badge", "badge-no-op", "unassign", "unassign-first"),
    )).resolves.toBe(1);
    await expect(value.store.unassignBadge(
      "badge-no-op",
      ["target-1"],
      audit("member_badge", "badge-no-op", "unassign", "unassign-repeat"),
    )).resolves.toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE action = 'unassign'")).toBe(1);
  });

  it("audits only the user ids actually changed by mixed badge requests", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO member_badges (
      id, name, label_html, color, description, sort_order, created_at, updated_at
    ) VALUES ('badge-mixed', 'Mixed Badge', '<b>Mixed</b>', '#fff', NULL, 0, ?, ?)`).run(NOW, NOW);
    value.database.prepare(`INSERT INTO member_badge_assignments (
      badge_id, user_id, assigned_by, assigned_at
    ) VALUES ('badge-mixed', 'target-1', 'admin-1', ?)`).run(NOW);

    await expect(value.store.assignBadge(
      "badge-mixed", ["target-1", "inactive-1"], "admin-1", NOW,
      audit("member_badge", "badge-mixed", "assign", "assign-mixed"),
    )).resolves.toBe(1);
    expect(auditUserIds(value.database, "assign-mixed")).toEqual(["inactive-1"]);
    expect(auditUserReferences(value.database, "assign-mixed")).toEqual([
      { id: "inactive-1", label: "Inactive" },
    ]);

    await expect(value.store.unassignBadge(
      "badge-mixed", ["target-1", "deleted-1"],
      audit("member_badge", "badge-mixed", "unassign", "unassign-mixed"),
    )).resolves.toBe(1);
    expect(auditUserIds(value.database, "unassign-mixed")).toEqual(["target-1"]);
    expect(auditUserReferences(value.database, "unassign-mixed")).toEqual([
      { id: "target-1", label: "Target" },
    ]);
  });

  it("pages badge assignments by a stable username and user-id cursor", async () => {
    const value = harness();
    value.database.prepare("INSERT INTO member_badges (id, name, label_html, color, description, sort_order, created_at, updated_at) VALUES ('badge', 'Badge', '<b>B</b>', '#fff', NULL, 0, ?, ?)").run(NOW, NOW);
    const assign = value.database.prepare(
      "INSERT INTO member_badge_assignments (badge_id, user_id, assigned_by, assigned_at) VALUES ('badge', ?, 'admin-1', ?)",
    );
    for (const [id, username] of [["alpha", "Alpha"], ["bravo", "Bravo"], ["charlie", "Charlie"]] as const) {
      insertUser(value.database, id, username, "member", true, null);
      assign.run(id, NOW);
    }

    const first = await value.store.listBadgeAssignments("badge", { limit: 2, cursor: null });
    expect(first.records.map(({ userId }) => userId)).toEqual(["alpha", "bravo"]);
    expect(first.hasMore).toBe(true);

    insertUser(value.database, "aaron", "Aaron", "member", true, null);
    assign.run("aaron", NOW);
    const last = first.records.at(-1)!;
    const second = await value.store.listBadgeAssignments("badge", {
      limit: 2,
      cursor: { username: last.username, userId: last.userId },
    });
    expect(second.records.map(({ userId }) => userId)).toEqual(["charlie"]);
    expect(second.hasMore).toBe(false);
  });

  it("enforces the badge catalog ceiling in the insert itself", async () => {
    const value = harness();
    const insert = value.database.prepare("INSERT INTO member_badges (id, name, label_html, color, description, sort_order, created_at, updated_at) VALUES (?, ?, 'x', '#fff', NULL, ?, ?, ?)");
    for (let index = 0; index < 200; index += 1) insert.run(`badge-${index}`, `Badge ${index}`, index, NOW, NOW);
    const outcome = await value.store.createBadge({
      id: "overflow", name: "Overflow", labelHtml: "x", color: "#fff", description: null, now: NOW,
    }, audit("member_badge", "overflow", "create"));
    expect(outcome).toBe("limit_reached");
    expect(scalar(value.database, "SELECT count(*) FROM member_badges")).toBe(200);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });
});

describe("SqliteMembersStore query plans", () => {
  it("uses roster, absence-window, and badge-user indexes", () => {
    const value = harness();
    const activeRoster = plan(value.database, "SELECT id FROM users WHERE deleted_at IS NULL AND is_active = 1 ORDER BY created_at, id LIMIT 500");
    expect(activeRoster).toContain("idx_users_roster");
    expect(activeRoster).not.toContain("USE TEMP B-TREE");
    const allRoster = plan(value.database, "SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 500");
    expect(allRoster).toContain("idx_users_roster_all");
    expect(allRoster).not.toContain("USE TEMP B-TREE");
    expect(plan(value.database, "SELECT id FROM member_absences WHERE end_date >= ? AND start_date <= ?", "2026-08-01", "2026-08-31"))
      .toContain("idx_member_absences_window");
    expect(plan(value.database, "SELECT badge_id FROM member_badge_assignments WHERE user_id = ?", "target-1"))
      .toContain("idx_member_badge_assignments_user");
  });
});

describe("SqliteMembersStore roster hydration", () => {
  it("hydrates a maximum roster page with four JSON-id queries", async () => {
    const value = harness();
    for (let index = 0; index < 497; index += 1) {
      insertUser(value.database, `page-${index}`, `Page ${index}`, "member", true, null);
    }
    const before = value.executor.statements.length;

    const page = await value.store.listRoster({
      page: 1,
      limit: LIMITS.pagination.users,
      search: "",
      includeTotal: true,
      projection: "admin",
    });

    expect(page.data).toHaveLength(LIMITS.pagination.users);
    const hydration = value.executor.statements.slice(before)
      .filter(({ sql }) => sql.includes("json_each(?)"));
    expect(hydration).toHaveLength(4);
    expect(hydration.every(({ params }) => params?.length === 1)).toBe(true);
  });
});

function plan(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): string {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map(({ detail }) => detail).join("\n");
}
