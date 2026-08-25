import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { AuthService, createInviteTokenCodec, createPasswordHash, IdentityAdminService } from "@guild/server/modules/auth";
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
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'normal',
    auth_revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_sessions_user_created ON sessions(user_id, created_at, token_digest);
  CREATE TABLE invite_links (
    id TEXT PRIMARY KEY, token_digest TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
    role_id TEXT NOT NULL REFERENCES roles(id), max_uses INTEGER NOT NULL, used_count INTEGER NOT NULL,
    expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE login_failures (login_name TEXT PRIMARY KEY, fail_count INTEGER NOT NULL, locked_until TEXT, last_failed_at TEXT NOT NULL);
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

function passwordAdminContext() {
  return createRequestContext({
    requestId: crypto.randomUUID(), now: NOW,
    authorization: createAuthorizationContext({
      userId: "admin-1", sessionId: "session", roleId: "admin", roleLevel: 900,
      permissions: ["admin.users.password"],
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

  it("rotates the temporary login, revokes sessions, clears locks, and audits in one batch", async () => {
    const value = harness();
    const targetRecord = (await value.store.findManagedUsers(["target-1"]))[0]!;
    value.database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope)
      VALUES ('old-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal')`).run(NOW);
    value.database.prepare(`INSERT INTO login_failures (login_name, fail_count, locked_until, last_failed_at)
      VALUES ('target-one', 4, '2026-08-09T12:05:00.000Z', ?),
        ('recovery-login', 2, NULL, ?)` ).run(NOW, NOW);
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
    expect(scalar(value.database, "SELECT count(*) FROM login_failures WHERE login_name IN ('target-one', 'recovery-login')")).toBe(0);
    expect(scalar(value.database, "SELECT auth_revision FROM user_credentials WHERE user_id = 'target-1'")).toBe(2);
    expect(scalar(value.database, "SELECT count(*) FROM external_identities WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM oauth_challenges WHERE user_id = 'target-1'")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'target-1'")).toBe(1);
  });

  it("leaves sessions, OAuth factors, and locks intact when an admin recovery races", async () => {
    const value = harness();
    const target = (await value.store.findManagedUsers(["target-1"]))[0]!;
    value.database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope)
      VALUES ('old-session', 'target-1', '2026-09-01T00:00:00.000Z', ?, 'normal')`).run(NOW);
    value.database.prepare(`INSERT INTO external_identities
      (id, user_id, provider, provider_subject, created_at, last_used_at)
      VALUES ('target-google', 'target-1', 'google', 'target-subject', ?, ?)`).run(NOW, NOW);
    value.database.prepare(`INSERT INTO login_failures (login_name, fail_count, locked_until, last_failed_at)
      VALUES ('target-one', 4, '2026-08-09T12:05:00.000Z', ?)`).run(NOW);
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
    expect(scalar(value.database, "SELECT count(*) FROM login_failures WHERE login_name = 'target-one'")).toBe(1);
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
    }))).resolves.toBe("conflict");
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
    expect(result).toBe("last_role_manager");
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

  it("creates authentication and member rows through one provisioning batch", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO invite_links (
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-1', 'digest-1', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    value.database.prepare(`INSERT INTO login_failures (login_name, fail_count, locked_until, last_failed_at)
      VALUES ('registered-login', 4, '2026-08-09T12:05:00.000Z', ?),
        ('managed-login', 4, '2026-08-09T12:05:00.000Z', ?)`).run(NOW, NOW);
    const registrationAudit = createAuditEvent(context(), {
      subjectType: "user", subjectId: "registered-1", action: "register",
    });

    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-1",
      tokenDigest: "digest-1",
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
      now: NOW,
    }, createAuditEvent(context(), {
      subjectType: "user", subjectId: "managed-1", action: "admin_create_member",
    }))).resolves.toBe("created");
    expect(scalar(value.database, "SELECT count(*) FROM user_credentials WHERE user_id = 'managed-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM member_profiles WHERE user_id = 'managed-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM login_failures WHERE login_name IN ('registered-login', 'managed-login')")).toBe(0);
  });

  it("rolls back invite use, account, credentials, and profile when the final audit write fails", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO invite_links (
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-rollback', 'digest-rollback', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
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
      tokenDigest: "digest-rollback",
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
  it("uses the unique token digest for exact invite-code lookup", async () => {
    const value = harness();
    const insert = value.database.prepare(`INSERT INTO invite_links (
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES (?, ?, 'admin-1', 'member', 5, 0, NULL, ?, NULL)`);
    insert.run("invite-target", "digest-target", NOW);
    insert.run("invite-other", "digest-other", NOW);

    await expect(value.store.listInvites({
      visibility: "active",
      limit: 50,
      cursor: null,
      search: "",
      exactTokenDigest: "digest-target",
      now: NOW,
    })).resolves.toMatchObject({ data: [{ id: "invite-target" }], total: 1 });

    await expect(value.store.findActiveInvite("digest-target", NOW))
      .resolves.toMatchObject({ id: "invite-target" });
  });

  it("searches invite creation and expiry dates without weakening exact-code lookup", async () => {
    const value = harness();
    const insert = value.database.prepare(`INSERT INTO invite_links (
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES (?, ?, 'admin-1', 'member', 5, 0, ?, ?, NULL)`);
    insert.run("invite-first", "digest-first", "2032-09-14T01:00:00.000Z", NOW);
    insert.run("invite-second", "digest-second", "2032-09-14T02:00:00.000Z", NOW);

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

describe("SqliteAuthStore persistent login locks", () => {
  it("returns 429 on the first locking failure and escalates after expiry", async () => {
    const value = harness();
    const passwordHash = await createPasswordHash("correct-password");
    value.database.prepare("UPDATE user_credentials SET password_hash = ?, updated_at = ? WHERE user_id = 'target-1'")
      .run(passwordHash, NOW);
    const auth = new AuthService({
      store: value.store,
      provisioning: value.provisioning,
      profiles: { readOwnProfile: async () => null },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(auth.login({ loginName: "target-one", password: "wrong", stayLoggedIn: false, now: NOW }))
        .rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    }
    await expect(auth.login({ loginName: "target-one", password: "wrong", stayLoggedIn: false, now: NOW }))
      .rejects.toMatchObject({
        code: "RATE_LIMITED",
        status: 429,
        details: { retry_after_seconds: 30, locked_until: "2026-08-09T12:00:30.000Z" },
      });
    await expect(auth.login({
      loginName: "target-one", password: "still-wrong", stayLoggedIn: false, now: "2026-08-09T12:00:10.000Z",
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retry_after_seconds: 20, locked_until: "2026-08-09T12:00:30.000Z" },
    });
    expect(scalar(value.database, "SELECT fail_count FROM login_failures WHERE login_name = 'target-one'")).toBe(4);

    await expect(auth.login({
      loginName: "target-one", password: "wrong", stayLoggedIn: false, now: "2026-08-09T12:00:30.000Z",
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      details: { retry_after_seconds: 60, locked_until: "2026-08-09T12:01:30.000Z" },
    });
  });

  it("keeps unknown and real login names on the same persistent failure response path", async () => {
    const value = harness();
    value.database.prepare("UPDATE user_credentials SET password_hash = ?, updated_at = ? WHERE user_id = 'target-1'")
      .run(await createPasswordHash("correct-password"), NOW);
    const auth = new AuthService({
      store: value.store,
      provisioning: value.provisioning,
      profiles: { readOwnProfile: async () => null },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });
    const capture = async (loginName: string) => {
      try {
        await auth.login({ loginName, password: "wrong", stayLoggedIn: false, now: NOW });
      } catch (error) {
        return error;
      }
      throw new Error("Expected login rejection");
    };
    expect(await capture("target-one")).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    expect(await capture("unknown-login")).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    expect(value.database.prepare(
      "SELECT login_name, fail_count FROM login_failures ORDER BY login_name",
    ).all()).toEqual([
      { login_name: "target-one", fail_count: 1 },
      { login_name: "unknown-login", fail_count: 1 },
    ]);
  });

  it("reads and atomically resets the previous state, including an explicit empty state", async () => {
    const value = harness();
    value.database.prepare(
      "INSERT INTO login_failures (login_name, fail_count, locked_until, last_failed_at) VALUES ('target-one', 6, '2026-08-09T12:05:00.000Z', ?)",
    ).run(NOW);
    const admin = new IdentityAdminService({
      store: value.store,
      provisioning: value.provisioning,
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });
    await expect(admin.getLoginLock(passwordAdminContext(), "target-1")).resolves.toEqual({
      failCount: 6,
      lockedUntil: "2026-08-09T12:05:00.000Z",
      isLocked: true,
      retryAfterSeconds: 300,
    });
    await expect(admin.resetLoginLock(passwordAdminContext(), "target-1")).resolves.toEqual({
      ok: true,
      failCount: 6,
      lockedUntil: "2026-08-09T12:05:00.000Z",
      isLocked: true,
      retryAfterSeconds: 300,
    });
    expect(scalar(value.database, "SELECT count(*) FROM login_failures")).toBe(0);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE action = 'reset_login_lock'")).toBe(1);
    expect(JSON.parse(String((value.database.prepare(
      "SELECT payload_json FROM audit_log WHERE action = 'reset_login_lock'",
    ).get() as { payload_json: string }).payload_json))).toEqual({
      schema_version: 2,
      changes: [],
      context: [
        { field: "failed_attempts", value: { type: "number", value: 6 } },
        { field: "locked_until", value: { type: "datetime", value: "2026-08-09T12:05:00.000Z" } },
      ],
    });

    await expect(admin.resetLoginLock(passwordAdminContext(), "target-1")).resolves.toEqual({
      ok: true, failCount: 0, lockedUntil: null, isLocked: false, retryAfterSeconds: 0,
    });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE action = 'reset_login_lock'")).toBe(2);
    expect(JSON.parse(String((value.database.prepare(
      "SELECT payload_json FROM audit_log WHERE action = 'reset_login_lock' ORDER BY rowid DESC LIMIT 1",
    ).get() as { payload_json: string }).payload_json))).toEqual({
      schema_version: 2,
      changes: [],
      context: [
        { field: "failed_attempts", value: { type: "number", value: 0 } },
        { field: "locked_until", value: { type: "null", value: null } },
      ],
    });
  });

  it("rejects a raced target revision without deleting the lock or writing audit", async () => {
    const value = harness();
    value.database.prepare(
      "INSERT INTO login_failures (login_name, fail_count, locked_until, last_failed_at) VALUES ('target-one', 4, '2026-08-09T12:00:30.000Z', ?)",
    ).run(NOW);
    const admin = new IdentityAdminService({
      store: value.store,
      provisioning: value.provisioning,
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });
    value.executor.beforeNextBatch = () => {
      value.database.prepare("UPDATE users SET revision_token = 'raced' WHERE id = 'target-1'").run();
    };
    await expect(admin.resetLoginLock(passwordAdminContext(), "target-1"))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(scalar(value.database, "SELECT count(*) FROM login_failures WHERE login_name = 'target-one'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("bounds stale failure pruning", async () => {
    const value = harness();
    const insert = value.database.prepare(
      "INSERT INTO login_failures (login_name, fail_count, locked_until, last_failed_at) VALUES (?, 1, NULL, '2026-08-01T00:00:00.000Z')",
    );
    for (let index = 0; index < 150; index += 1) insert.run(`stale-${String(index).padStart(3, "0")}`);
    await value.store.pruneLoginFailures("2026-08-08T00:00:00.000Z", NOW, 100);
    expect(scalar(value.database, "SELECT count(*) FROM login_failures")).toBe(50);
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
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-duplicate', 'digest-duplicate', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-duplicate",
      tokenDigest: "digest-duplicate",
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
