import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAuthorizationContext,
  createRequestContext,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlResult,
  type SqlStatement,
} from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import { createAppDatabase } from "../database.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAuthStore } from "./auth-store.js";
import { SqliteAccountProvisioningStore } from "./account-provisioning-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const BASE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE roles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, level INTEGER NOT NULL, color TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL, PRIMARY KEY(role_id, permission)
  );
  CREATE INDEX idx_role_permissions_permission ON role_permissions(permission, role_id);
  CREATE TABLE users (
    id TEXT PRIMARY KEY, display_name TEXT NOT NULL UNIQUE, role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL CHECK(is_active IN (0, 1)), deleted_at TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE INDEX idx_users_role ON users(role_id, deleted_at, is_active);
  CREATE UNIQUE INDEX ux_users_display_name_nocase ON users(display_name COLLATE NOCASE);
  CREATE TABLE user_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id), login_name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, temporary_password_expires_at TEXT, temporary_password_used_at TEXT,
    updated_at TEXT NOT NULL, auth_revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX ux_user_credentials_login_name_nocase ON user_credentials(login_name COLLATE NOCASE);
  CREATE TABLE member_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id), power REAL NOT NULL DEFAULT 0,
    title_html TEXT, bio TEXT, availability_timezone TEXT, notes TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE class_catalog (id TEXT PRIMARY KEY);
  CREATE TABLE member_profile_classes (
    user_id TEXT NOT NULL REFERENCES member_profiles(user_id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES class_catalog(id),
    sort_order INTEGER NOT NULL,
    PRIMARY KEY(user_id, class_id)
  );
  CREATE TABLE member_availability_windows (
    user_id TEXT NOT NULL REFERENCES member_profiles(user_id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL, start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL,
    PRIMARY KEY(user_id, weekday, start_minute, end_minute)
  );
  CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'normal',
    auth_revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_sessions_user_created ON sessions(user_id, created_at, token_digest);
  CREATE TABLE invite_links (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
    role_id TEXT NOT NULL REFERENCES roles(id), max_uses INTEGER NOT NULL, used_count INTEGER NOT NULL,
    expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE external_identities (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, provider_subject TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL
  );
  CREATE TABLE oauth_challenges (
    state_digest TEXT PRIMARY KEY, browser_binding_digest TEXT NOT NULL, provider TEXT NOT NULL, purpose TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE, nonce TEXT, pkce_verifier TEXT, expires_at TEXT NOT NULL,
    consumed_at TEXT, created_at TEXT NOT NULL, auth_revision INTEGER
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
    actor_label TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_label TEXT,
    action TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
  );
`;

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

class RejectSnapshotExecutor implements SqlExecutor {
  constructor(
    private readonly delegate: SqliteTestExecutor,
    private readonly rejects: (statement: SqlBatchStatement) => boolean,
  ) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    return this.delegate.execute(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    return this.delegate.batch(statements.map((statement): SqlBatchStatement => this.rejects(statement)
      ? {
          method: "all",
          columns: ["snapshot_failure"],
          sql: "SELECT missing_role_snapshot_column",
          params: [],
        }
      : statement));
  }
}

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(BASE_SCHEMA);
  database.exec(readFileSync(fileURLToPath(new URL("../schema/auth-triggers.sql", import.meta.url)), "utf8"));
  const insertRole = database.prepare("INSERT INTO roles (id, name, level, revision_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  insertRole.run("admin", "Admin", 1000, "admin-v1", NOW, NOW);
  insertRole.run("member", "Member", 100, "member-v1", NOW, NOW);
  insertRole.run("officer", "Officer", 200, "officer-v1", NOW, NOW);
  database.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('admin', 'admin.roles.manage')").run();
  const insertUser = database.prepare(`INSERT INTO users (
    id, display_name, role_id, is_active, deleted_at, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
  insertUser.run("admin-1", "Admin", "admin", 1, "admin-user-v1", NOW, NOW);
  insertUser.run("target-1", "Target One", "member", 1, "target-1-v1", NOW, NOW);
  insertUser.run("target-2", "Target Two", "member", 1, "target-2-v1", NOW, NOW);
  const insertCredential = database.prepare(
    "INSERT INTO user_credentials (user_id, login_name, password_hash, updated_at) VALUES (?, ?, 'seed-hash', ?)",
  );
  insertCredential.run("admin-1", "admin-login", NOW);
  insertCredential.run("target-1", "target-one", NOW);
  insertCredential.run("target-2", "target-two", NOW);
  const insertProfile = database.prepare(
    "INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at) VALUES (?, 0, ?, ?, ?)",
  );
  insertProfile.run("admin-1", "admin-profile-v1", NOW, NOW);
  insertProfile.run("target-1", "target-1-profile-v1", NOW, NOW);
  insertProfile.run("target-2", "target-2-profile-v1", NOW, NOW);
  database.prepare("INSERT INTO class_catalog (id) VALUES ('guardian')").run();
  const executor = new SqliteTestExecutor(database);
  return {
    database,
    executor,
    provisioning: new SqliteAccountProvisioningStore(createAppDatabase(executor), executor),
    store: new SqliteAuthStore(createAppDatabase(executor), executor),
  };
}

function context() {
  return createRequestContext({
    requestId: crypto.randomUUID(), now: NOW,
    authorization: createAuthorizationContext({
      userId: "admin-1", sessionId: "session", roleId: "admin", roleLevel: 900,
      permissions: ["admin.roles.manage"],
    }),
  });
}

function audit(entityId: string, action: "update" | "deactivate") {
  return createAuditEvent(context(), { subjectType: "user", subjectId: entityId, action });
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

describe("SqliteAuthStore guarded mutations", () => {
  it("rolls the role and audit back when its in-batch role snapshot fails", async () => {
    const value = harness();
    const failingExecutor = new RejectSnapshotExecutor(
      value.executor,
      (statement) => statement.columns?.includes("assigned_user_count") === true,
    );
    const store = new SqliteAuthStore(createAppDatabase(failingExecutor), failingExecutor);

    await expect(store.createRole({
      id: "snapshot-role",
      name: "Snapshot role",
      level: 150,
      color: null,
      permissions: ["announcements.create"],
      now: NOW,
    }, createAuditEvent(context(), {
      subjectType: "role",
      subjectId: "snapshot-role",
      action: "create",
    }))).rejects.toThrow(/missing_role_snapshot_column/);

    expect(scalar(value.database, "SELECT count(*) FROM roles WHERE id = 'snapshot-role'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'snapshot-role'")).toBe(0);
  });

  it("consumes temporary credentials and completes reset exactly once at the same timestamp", async () => {
    const value = harness();
    value.database.prepare(`UPDATE user_credentials SET
      login_name = 'temporary-login', password_hash = 'temporary-hash',
      temporary_password_expires_at = '2026-08-09T12:15:00.000Z',
      temporary_password_used_at = NULL, updated_at = ?
      WHERE user_id = 'target-1'`).run(NOW);

    const consumeInput = {
      userId: "target-1",
      passwordHash: "temporary-hash",
      now: NOW,
      expiresAt: "2026-08-09T12:15:00.000Z",
      maximumSessions: 10,
      authRevision: 1,
    };
    await expect(value.store.consumeTemporaryPasswordAndOpenSession({
      ...consumeInput,
      tokenDigest: "restricted-1",
    })).resolves.toBe(true);
    await expect(value.store.consumeTemporaryPasswordAndOpenSession({
      ...consumeInput,
      tokenDigest: "restricted-2",
    })).resolves.toBe(false);
    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE token_digest = 'restricted-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE token_digest = 'restricted-2'")).toBe(0);

    const completionInput = {
      userId: "target-1",
      restrictedSessionTokenDigest: "restricted-1",
      previousLoginName: "temporary-login",
      loginName: "permanent-login",
      passwordHash: "permanent-hash",
      now: NOW,
      expiresAt: "2026-09-08T12:00:00.000Z",
      maximumSessions: 10,
      authRevision: 1,
    };
    await expect(value.store.completeTemporaryPasswordAndOpenSession({
      ...completionInput,
      tokenDigest: "normal-1",
      audit: createAuditEvent(context(), { subjectType: "user_auth", subjectId: "target-1", action: "update" }),
    })).resolves.toBe("completed");
    await expect(value.store.completeTemporaryPasswordAndOpenSession({
      ...completionInput,
      tokenDigest: "normal-2",
      audit: createAuditEvent(context(), { subjectType: "user_auth", subjectId: "target-1", action: "update" }),
    })).resolves.toBe("invalid");

    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE token_digest = 'normal-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE token_digest = 'normal-2'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(1);
  });

  it("rotates the temporary login, revokes sessions and OAuth factors, and audits in one batch", async () => {
    const value = harness();
    const targetRecord = (await value.store.findManagedUsers(["target-1"]))[0]!;
    value.database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope)
      VALUES ('old-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal')`).run(NOW);
    value.database.prepare(`INSERT INTO external_identities
      (id, user_id, provider, provider_subject, created_at, last_used_at)
      VALUES ('target-google', 'target-1', 'google', 'target-subject', ?, ?)`).run(NOW, NOW);
    value.database.prepare(`INSERT INTO oauth_challenges
      (state_digest, browser_binding_digest, provider, purpose, user_id, expires_at, consumed_at, created_at, auth_revision)
      VALUES ('target-link', 'binding', 'google', 'link', 'target-1', '2026-08-09T12:15:00.000Z', NULL, ?, 1)`).run(NOW);

    await expect(value.store.setTemporaryPassword({
      target: targetRecord,
      actorUserId: "admin-1",
      expectedActorAuthRevision: 1,
      temporaryLoginName: "recovery-login",
      passwordHash: "temporary-hash",
      expiresAt: "2026-08-09T12:15:00.000Z",
      now: NOW,
      audit: createAuditEvent(context(), { subjectType: "user_auth", subjectId: "target-1", action: "reset_password" }),
    })).resolves.toBe("updated");

    expect(value.database.prepare(`SELECT login_name, password_hash, temporary_password_expires_at
      FROM user_credentials WHERE user_id = 'target-1'`).get()).toEqual({
      login_name: "recovery-login",
      password_hash: "temporary-hash",
      temporary_password_expires_at: "2026-08-09T12:15:00.000Z",
    });
    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT auth_revision FROM user_credentials WHERE user_id = 'target-1'")).toBe(2);
    expect(scalar(value.database, "SELECT count(*) FROM external_identities WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM oauth_challenges WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(1);
  });

  it("leaves sessions and OAuth factors intact when an admin recovery races", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    value.database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope)
      VALUES ('old-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal')`).run(NOW);
    value.database.prepare(`INSERT INTO external_identities
      (id, user_id, provider, provider_subject, created_at, last_used_at)
      VALUES ('target-google', 'target-1', 'google', 'target-subject', ?, ?)`).run(NOW, NOW);
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE user_credentials SET auth_revision = auth_revision + 1 WHERE user_id = 'target-1'").run();
    };

    await expect(value.store.setTemporaryPassword({
      target,
      actorUserId: "admin-1",
      expectedActorAuthRevision: 1,
      temporaryLoginName: "recovery-login",
      passwordHash: "temporary-hash",
      expiresAt: "2026-08-09T12:15:00.000Z",
      now: NOW,
      audit: createAuditEvent(context(), { subjectType: "user_auth", subjectId: "target-1", action: "reset_password" }),
    })).resolves.toBe("conflict");

    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE user_id = 'target-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM external_identities WHERE user_id = 'target-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("leaves the target untouched when the verified administrator credential revision changes", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'admin-1'").run();
    };

    await expect(value.store.setTemporaryPassword({
      target,
      actorUserId: "admin-1",
      expectedActorAuthRevision: 1,
      temporaryLoginName: "recovery-login",
      passwordHash: "temporary-hash",
      expiresAt: "2026-08-09T12:15:00.000Z",
      now: NOW,
      audit: createAuditEvent(context(), { subjectType: "user_auth", subjectId: "target-1", action: "reset_password" }),
    })).resolves.toBe("conflict");

    expect(value.database.prepare("SELECT login_name, password_hash FROM user_credentials WHERE user_id = 'target-1'").get())
      .toEqual({ login_name: "target-one", password_hash: "seed-hash" });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("leaves display names and audits untouched when a current-password confirmation becomes stale", async () => {
    const value = harness();
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'target-1'").run();
    };


    expect(value.database.prepare("SELECT display_name FROM users WHERE id = 'target-1'").get())
      .toEqual({ display_name: "Target One" });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("rejects stale session issuance and stale rehashes after a credential revision changes", async () => {
    const value = harness();
    value.database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'target-1'").run();

    await expect(value.store.rehashPassword({
      userId: "target-1",
      expectedPasswordHash: "seed-hash",
      expectedAuthRevision: 1,
      passwordHash: "raced-hash",
      now: NOW,
    })).resolves.toBe(false);
    await expect(value.store.openUserSession({
      userId: "target-1",
      tokenDigest: "raced-session",
      expiresAt: "2026-08-10T12:00:00.000Z",
      createdAt: NOW,
      maximumSessions: 3,
      expectedAuthRevision: 1,
    })).resolves.toBe(false);

    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE token_digest = 'raced-session'")).toBe(0);
    expect(value.database.prepare("SELECT password_hash FROM user_credentials WHERE user_id = 'target-1'").get())
      .toEqual({ password_hash: "seed-hash" });
  });

  it("rejects sessions whose credential revision has been revoked", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO sessions
      (token_digest, user_id, expires_at, created_at, scope, auth_revision)
      VALUES ('revoked-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal', 1)`).run(NOW);
    value.database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'target-1'").run();

    await expect(value.store.findSessionAuthorization("revoked-session")).resolves.toBeNull();
  });

  it("hydrates many session authorizations with one bounded JSON query and omits revoked sessions", async () => {
    const value = harness();
    value.database.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('member', 'events.create')").run();
    const insertSession = value.database.prepare(`INSERT INTO sessions
      (token_digest, user_id, expires_at, created_at, scope, auth_revision)
      VALUES (?, ?, '2026-09-01T00:00:00.000Z', ?, 'normal', 1)`);
    insertSession.run("bulk-session-1", "target-1", NOW);
    insertSession.run("bulk-session-2", "target-2", NOW);
    value.database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'target-2'").run();

    const records = await value.store.findSessionAuthorizations([
      "bulk-session-1",
      "bulk-session-2",
      "missing-session",
    ]);

    expect([...records.keys()]).toEqual(["bulk-session-1"]);
    expect(records.get("bulk-session-1")).toMatchObject({
      id: "target-1",
      tokenDigest: "bulk-session-1",
      permissions: new Set(["events.create"]),
    });
    await expect(value.store.findSessionAuthorizations(["bulk-session-1", "bulk-session-1"]))
      .rejects.toThrow("unique and bounded");
  });

  it("bounds the role catalog and keeps direct role lookup bounded", async () => {
    const value = harness();
    const insertRole = value.database.prepare(
      "INSERT INTO roles (id, name, level, revision_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (let index = 0; index < 47; index += 1) {
      const id = `custom-${String(index).padStart(2, "0")}`;
      insertRole.run(id, id, index, `${id}-v1`, NOW, NOW);
    }

    await expect(value.store.createRole({
      id: "overflow",
      name: "Overflow",
      level: 1,
      color: null,
      permissions: [],
      now: NOW,
    }, createAuditEvent(context(), {
      subjectType: "role",
      subjectId: "overflow",
      action: "create",
    }))).resolves.toEqual({ status: "conflict" });
    expect(scalar(value.database, "SELECT count(*) FROM roles")).toBe(50);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);

    insertRole.run("corrupt-extra", "Corrupt Extra", 1, "extra-v1", NOW, NOW);
    await expect(value.store.listRoles()).rejects.toThrow("hard limit");
    await expect(value.store.findRole("officer")).resolves.toMatchObject({ id: "officer" });
  });

  it("rejects a stale target without changing any batch member or writing audit", async () => {
    const value = harness();
    const targets = await value.store.findManagedUsers(["target-1", "target-2"]);
    const destinationRole = await value.store.findRole("officer");
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE users SET revision_token = 'raced' WHERE id = 'target-2'").run();
    };

    await expect(value.store.setUsersRole({ targets, destinationRole: destinationRole!, now: NOW }, audit("batch", "update")))
      .resolves.toBe("conflict");
    expect(scalar(value.database, "SELECT count(*) FROM users WHERE role_id = 'officer'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("rejects a stale destination permission/level snapshot", async () => {
    const value = harness();
    const targets = await value.store.findManagedUsers(["target-1"]);
    const destinationRole = await value.store.findRole("officer");
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE roles SET level = 950, revision_token = 'raced' WHERE id = 'officer'").run();
    };
    await expect(value.store.setUsersRole({ targets, destinationRole: destinationRole!, now: NOW }, audit("target-1", "update")))
      .resolves.toBe("conflict");
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("keeps the last active role manager and rolls back its audit", async () => {
    const value = harness();
    const [manager] = await value.store.findManagedUsers(["admin-1"]);
    await expect(value.store.setUsersActive({ targets: [manager!], active: false, now: NOW }, audit("admin-1", "deactivate")))
      .resolves.toBe("last_role_manager");
    expect(scalar(value.database, "SELECT is_active FROM users WHERE id = 'admin-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("rolls back role metadata and audit when the final manager grant would be removed", async () => {
    const value = harness();
    const role = await value.store.findRole("admin");
    const result = await value.store.updateRole({
      id: role!.id,
      name: "Renamed",
      permissionDelta: { add: [], remove: ["admin.roles.manage"] },
      expectedRevisionToken: role!.revisionToken,
      expectedPermissions: [...role!.permissions],
      now: NOW,
    }, createAuditEvent(context(), { subjectType: "role", subjectId: "admin", action: "update" }));
    expect(result).toEqual({ status: "last_role_manager" });
    expect(value.database.prepare("SELECT name FROM roles WHERE id = 'admin'").get()).toMatchObject({ name: "Admin" });
    expect(scalar(value.database, "SELECT count(*) FROM role_permissions WHERE permission = 'admin.roles.manage'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });
});

describe("account provisioning ownership", () => {
  it("keeps member profile DML out of SqliteAuthStore", () => {
    const source = readFileSync(fileURLToPath(new URL("./auth-store.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("member_profiles");
  });

  it("rejects an A/B stale user baseline even when the service has already reread B's target", async () => {
    const value = harness();
    const openedByA = (await value.store.findManagedUsers(["target-1"]))[0]!;
    const expectedProfileRevisionToken = "target-1-profile-v1";
    value.database.prepare("UPDATE users SET revision_token = 'target-1-b-v2' WHERE id = 'target-1'").run();
    const rereadForSave = (await value.store.findManagedUsers(["target-1"]))[0]!;

    await expect(value.provisioning.updateManagedMember({
      target: rereadForSave,
      expectedUserRevisionToken: openedByA.revisionToken,
      expectedProfileRevisionToken,
      profile: {
        power: 42,
        classes: ["guardian"],
        titleHtml: null,
        bio: "A's stale draft",
        availability: null,
        notes: null,
      },
      now: NOW,
    }, audit("target-1", "update"))).resolves.toBe("conflict");

    expect(value.database.prepare("SELECT power, bio FROM member_profiles WHERE user_id = 'target-1'").get())
      .toEqual({ power: 0, bio: null });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(0);
  });

  it("leaves role, lifecycle, profile, sessions, and audit untouched when the profile CAS becomes stale", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    const destinationRole = (await value.store.findRole("officer"))!;
    value.database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope)
      VALUES ('target-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal')`).run(NOW);
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE member_profiles SET revision_token = 'profile-raced' WHERE user_id = 'target-1'").run();
    };

    await expect(value.provisioning.updateManagedMember({
      target,
      expectedUserRevisionToken: target.revisionToken,
      expectedProfileRevisionToken: "target-1-profile-v1",
      destinationRole,
      active: false,
      profile: {
        power: 42,
        classes: ["guardian"],
        titleHtml: "<b>Officer</b>",
        bio: "Coordinates raids",
        availability: null,
        notes: "Private officer note",
      },
      now: NOW,
    }, audit("target-1", "update"))).resolves.toBe("conflict");

    expect(value.database.prepare("SELECT role_id, is_active FROM users WHERE id = 'target-1'").get())
      .toEqual({ role_id: "member", is_active: 1 });
    expect(value.database.prepare("SELECT power, notes FROM member_profiles WHERE user_id = 'target-1'").get())
      .toEqual({ power: 0, notes: null });
    expect(scalar(value.database, "SELECT count(*) FROM member_profile_classes WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE user_id = 'target-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(0);
  });

  it("leaves the whole command untouched when the assignable role snapshot becomes stale", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    const destinationRole = (await value.store.findRole("officer"))!;
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE roles SET revision_token = 'officer-raced' WHERE id = 'officer'").run();
    };

    await expect(value.provisioning.updateManagedMember({
      target,
      expectedUserRevisionToken: target.revisionToken,
      expectedProfileRevisionToken: "target-1-profile-v1",
      destinationRole,
      profile: {
        power: 42,
        classes: [],
        titleHtml: null,
        bio: null,
        availability: null,
        notes: null,
      },
      now: NOW,
    }, audit("target-1", "update"))).resolves.toBe("conflict");

    expect(value.database.prepare("SELECT role_id FROM users WHERE id = 'target-1'").get())
      .toEqual({ role_id: "member" });
    expect(value.database.prepare("SELECT power FROM member_profiles WHERE user_id = 'target-1'").get())
      .toEqual({ power: 0 });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(0);
  });

  it("commits a combined member edit with one audit row and revokes sessions for a role/lifecycle change", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    const destinationRole = (await value.store.findRole("officer"))!;
    value.database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope)
      VALUES ('target-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal')`).run(NOW);

    await expect(value.provisioning.updateManagedMember({
      target,
      expectedUserRevisionToken: target.revisionToken,
      expectedProfileRevisionToken: "target-1-profile-v1",
      destinationRole,
      active: false,
      profile: {
        power: 42,
        classes: ["guardian"],
        titleHtml: "<b>Officer</b>",
        bio: "Coordinates raids",
        availability: null,
        notes: "Private officer note",
      },
      now: NOW,
    }, audit("target-1", "update"))).resolves.toBe("updated");

    expect(value.database.prepare("SELECT role_id, is_active FROM users WHERE id = 'target-1'").get())
      .toEqual({ role_id: "officer", is_active: 0 });
    expect(value.database.prepare("SELECT power, title_html, bio, notes FROM member_profiles WHERE user_id = 'target-1'").get())
      .toEqual({
        power: 42,
        title_html: "<b>Officer</b>",
        bio: "Coordinates raids",
        notes: "Private officer note",
      });
    expect(value.database.prepare("SELECT class_id, sort_order FROM member_profile_classes WHERE user_id = 'target-1'").all())
      .toEqual([{ class_id: "guardian", sort_order: 0 }]);
    expect(scalar(value.database, "SELECT count(*) FROM sessions WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(1);
  });

  it("updates a display name and availability with the same guarded member command", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    const changeAudit = audit("target-1", "update");

    await expect(value.provisioning.updateManagedMember({
      target,
      expectedUserRevisionToken: target.revisionToken,
      expectedProfileRevisionToken: "target-1-profile-v1",
      displayName: "RenamedTarget",
      profile: {
        power: 42,
        classes: ["guardian"],
        titleHtml: null,
        bio: null,
        availability: {
          timezone: "UTC",
          days: {
            sunday: [],
            monday: [{ start_utc: "20:00", end_utc: "22:00" }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
          },
        },
        notes: null,
      },
      now: NOW,
    }, changeAudit)).resolves.toBe("updated");

    expect(value.database.prepare("SELECT display_name, revision_token FROM users WHERE id = 'target-1'").get())
      .toEqual({ display_name: "RenamedTarget", revision_token: changeAudit.eventId });
    expect(value.database.prepare("SELECT availability_timezone, revision_token FROM member_profiles WHERE user_id = 'target-1'").get())
      .toEqual({ availability_timezone: "UTC", revision_token: changeAudit.eventId });
    expect(value.database.prepare(`SELECT weekday, start_minute, end_minute
      FROM member_availability_windows WHERE user_id = 'target-1'`).all())
      .toEqual([{ weekday: 1, start_minute: 1200, end_minute: 1320 }]);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(1);
  });

  it("reports a case-insensitive display-name collision without partial writes", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;

    await expect(value.provisioning.updateManagedMember({
      target,
      expectedUserRevisionToken: target.revisionToken,
      expectedProfileRevisionToken: "target-1-profile-v1",
      displayName: "target two",
      now: NOW,
    }, audit("target-1", "update"))).resolves.toBe("display_name_taken");

    expect(value.database.prepare("SELECT display_name, revision_token FROM users WHERE id = 'target-1'").get())
      .toEqual({ display_name: "Target One", revision_token: "target-1-v1" });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(0);
  });

  it("maps the final-role-manager trigger to a conflict outcome without partial profile writes", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["admin-1"]))[0]!;
    const destinationRole = (await value.store.findRole("member"))!;

    await expect(value.provisioning.updateManagedMember({
      target,
      expectedUserRevisionToken: target.revisionToken,
      expectedProfileRevisionToken: "admin-profile-v1",
      destinationRole,
      active: false,
      profile: {
        power: 42,
        classes: [],
        titleHtml: "<b>Officer</b>",
        bio: "Coordinates raids",
        availability: null,
        notes: "Private officer note",
      },
      now: NOW,
    }, audit("admin-1", "update"))).resolves.toBe("last_role_manager");

    expect(value.database.prepare("SELECT role_id, is_active FROM users WHERE id = 'admin-1'").get())
      .toEqual({ role_id: "admin", is_active: 1 });
    expect(value.database.prepare("SELECT power, notes FROM member_profiles WHERE user_id = 'admin-1'").get())
      .toEqual({ power: 0, notes: null });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'admin-1'")).toBe(0);
  });

  it("creates authentication and member rows through one provisioning batch", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO invite_links (
      id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-1', 'A1B2C3D4E5', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    const registrationAudit = createAuditEvent(context(), {
      subjectType: "user", subjectId: "registered-1", action: "register",
    });

    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-1",
      inviteCode: "A1B2C3D4E5",
      userId: "registered-1",
      loginName: "registered-login",
      displayName: "Registered One",
      passwordHash: "registration-hash",
      now: NOW,
    }, registrationAudit)).resolves.toBe("created");
    expect(scalar(value.database, "SELECT count(*) FROM users WHERE id = 'registered-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM user_credentials WHERE user_id = 'registered-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM member_profiles WHERE user_id = 'registered-1'")).toBe(1);
    expect(scalar(value.database, "SELECT used_count FROM invite_links WHERE id = 'invite-1'")).toBe(1);

    const destinationRole = await value.store.findRole("member");
    await expect(value.provisioning.createManagedUser({
      id: "managed-1",
      loginName: "managed-login",
      displayName: "Managed One",
      roleId: "member",
      passwordHash: "managed-hash",
      temporaryPasswordExpiresAt: "2026-08-09T12:15:00.000Z",
      destinationRole: destinationRole!,
      notes: "Initial officer note",
      now: NOW,
    }, createAuditEvent(context(), {
      subjectType: "user", subjectId: "managed-1", action: "admin_create_member",
    }))).resolves.toBe("created");
    expect(scalar(value.database, "SELECT count(*) FROM user_credentials WHERE user_id = 'managed-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM member_profiles WHERE user_id = 'managed-1'")).toBe(1);
    expect(value.database.prepare(
      "SELECT notes FROM member_profiles WHERE user_id = 'managed-1'",
    ).get()).toEqual({ notes: "Initial officer note" });
  });

  it("rolls back invite use, account, credentials, and profile when the final audit write fails", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO invite_links (
      id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-rollback', 'R1O2L3L4B5', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    const duplicateAudit = createAuditEvent(context(), {
      subjectType: "user", subjectId: "rollback-user", action: "register",
    });
    value.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      duplicateAudit.eventId,
      duplicateAudit.requestId,
      duplicateAudit.actorKind,
      duplicateAudit.actorId,
      duplicateAudit.actorLabel,
      duplicateAudit.subjectType,
      duplicateAudit.subjectId,
      duplicateAudit.subjectLabel,
      duplicateAudit.action,
      JSON.stringify(duplicateAudit.payload),
      duplicateAudit.occurredAt,
    );

    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-rollback",
      inviteCode: "R1O2L3L4B5",
      userId: "rollback-user",
      loginName: "rollback-login",
      displayName: "Rollback User",
      passwordHash: "rollback-hash",
      now: NOW,
    }, duplicateAudit)).resolves.toBe("invite_unavailable");
    expect(scalar(value.database, "SELECT used_count FROM invite_links WHERE id = 'invite-rollback'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM users WHERE id = 'rollback-user'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM user_credentials WHERE user_id = 'rollback-user'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM member_profiles WHERE user_id = 'rollback-user'")).toBe(0);
  });
});

describe("SqliteAuthStore invite lookup", () => {
  it("uses the unique invite code for registration lookup", async () => {
    const value = harness();
    const insert = value.database.prepare(`INSERT INTO invite_links (
      id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES (?, ?, 'admin-1', 'member', 5, 0, NULL, ?, NULL)`);
    insert.run("invite-target", "T1A2R3G4E5", NOW);
    insert.run("invite-other", "O1T2H3E4R5", NOW);

    await expect(value.store.findActiveInvite("T1A2R3G4E5", NOW))
      .resolves.toMatchObject({ id: "invite-target" });
  });

  it("searches invite codes, creation dates, and expiry dates", async () => {
    const value = harness();
    const insert = value.database.prepare(`INSERT INTO invite_links (
      id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES (?, ?, 'admin-1', 'member', 5, 0, ?, ?, NULL)`);
    insert.run("invite-first", "F1I2R3S4T5", "2032-09-14T01:00:00.000Z", NOW);
    insert.run("invite-second", "S1E2C3O4N5", "2032-09-14T02:00:00.000Z", NOW);

    await expect(value.store.listInvites({
      visibility: "active",
      limit: 50,
      cursor: null,
      search: "2032-09-14",
      now: NOW,
    })).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ id: "invite-first" }),
        expect.objectContaining({ id: "invite-second" }),
      ]),
      total: 2,
    });
  });
});

describe("SqliteAuthStore session issue records the login", () => {
  function lastLoginOf(database: DatabaseSync, userId: string): string | null {
    const row = database.prepare("SELECT last_login_at FROM users WHERE id = ?").get(userId) as
      | { last_login_at: string | null }
      | undefined;
    return row?.last_login_at ?? null;
  }

  it("stamps the login moment in the same batch that issues the session", async () => {
    const value = harness();
    expect(lastLoginOf(value.database, "target-1")).toBeNull();

    await value.store.openUserSession({
      userId: "target-1",
      tokenDigest: "digest-1",
      expiresAt: "2026-08-24T12:00:00.000Z",
      createdAt: NOW,
      maximumSessions: 5,
      expectedAuthRevision: 1,
    });

    expect(lastLoginOf(value.database, "target-1")).toBe(NOW);
    expect(scalar(value.database, "SELECT COUNT(*) FROM sessions WHERE user_id = 'target-1'")).toBe(1);
  });

  it("moves the stamp forward on a later sign-in and leaves other members alone", async () => {
    const value = harness();
    const later = "2026-08-10T09:30:00.000Z";
    for (const [tokenDigest, createdAt] of [["digest-1", NOW], ["digest-2", later]] as const) {
      await value.store.openUserSession({
        userId: "target-1",
        tokenDigest,
        expiresAt: "2026-08-24T12:00:00.000Z",
        createdAt,
        maximumSessions: 5,
        expectedAuthRevision: 1,
      });
    }

    expect(lastLoginOf(value.database, "target-1")).toBe(later);
    expect(lastLoginOf(value.database, "target-2")).toBeNull();
  });

  /* 登录不该动 updated_at / revision_token：那两个字段服务于资料修改和乐观并发，
     一次登录把全站成员 ETag 冲掉不值当。 */
  it("leaves the profile revision untouched so a sign-in does not invalidate member reads", async () => {
    const value = harness();
    const before = value.database.prepare(
      "SELECT updated_at, revision_token FROM users WHERE id = ?",
    ).get("target-1");

    await value.store.openUserSession({
      userId: "target-1",
      tokenDigest: "digest-1",
      expiresAt: "2026-08-24T12:00:00.000Z",
      createdAt: "2026-08-10T09:30:00.000Z",
      maximumSessions: 5,
      expectedAuthRevision: 1,
    });

    expect(value.database.prepare(
      "SELECT updated_at, revision_token FROM users WHERE id = ?",
    ).get("target-1")).toEqual(before);
  });
});

describe("SqliteAuthStore query plan", () => {
  it("uses the NOCASE login-name index for authentication and provisioning lookups", async () => {
    const value = harness();
    value.database.prepare(
      "UPDATE user_credentials SET password_hash = 'hash', updated_at = ? WHERE user_id = 'target-1'",
    ).run(NOW);

    await expect(value.store.findLoginName("target-1")).resolves.toBe("target-one");
    const lookupStart = value.executor.statements.length;
    await expect(value.store.findLoginAccount("target-one")).resolves.toMatchObject({
      loginName: "target-one",
      displayName: "Target One",
    });
    const lookupStatements = value.executor.statements.slice(lookupStart);

    value.database.prepare(`INSERT INTO invite_links (
      id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-duplicate', 'D1U2P3L4C5', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-duplicate",
      inviteCode: "D1U2P3L4C5",
      userId: "duplicate-user",
      loginName: "TARGET-ONE",
      displayName: "Duplicate User",
      passwordHash: "hash",
      now: NOW,
    }, createAuditEvent(context(), {
      subjectType: "user", subjectId: "duplicate-user", action: "register",
    }))).resolves.toBe("login_name_taken");
    const provisioningLookup = value.executor.statements.at(-1)!;

    for (const statement of [...lookupStatements, provisioningLookup]) {
      const rows = value.database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
        .all(...[...(statement.params ?? [])] as SQLInputValue[]) as Array<{ detail: string }>;
      expect(rows.map(({ detail }) => detail).join("\n")).toContain("ux_user_credentials_login_name_nocase");
    }
  });

  it("uses token and permission indexes for the one-query session projection", () => {
    const value = harness();
    value.database.prepare("INSERT INTO sessions (token_digest, user_id, expires_at, created_at) VALUES ('digest', 'admin-1', ?, ?)").run(NOW, NOW);
    const rows = value.database.prepare(`EXPLAIN QUERY PLAN
      SELECT u.id, rp.permission FROM sessions AS s
      JOIN users AS u ON u.id = s.user_id
      LEFT JOIN role_permissions AS rp ON rp.role_id = u.role_id
      WHERE s.token_digest = ?`).all("digest") as Array<{ detail: string }>;
    const plan = rows.map(({ detail }) => detail).join("\n");
    expect(plan).toContain("sqlite_autoindex_sessions_1");
    expect(plan).toContain("sqlite_autoindex_role_permissions_1");
  });
});
