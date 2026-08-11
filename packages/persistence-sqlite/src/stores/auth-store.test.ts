import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { AuthService, createInviteTokenCodec, createPasswordHash, IdentityAdminService } from "@guild/server/modules/auth";
import { createAuditMutation } from "@guild/server/modules/audit";
import { createAppDatabase } from "../database.js";
import { assertSqlStatement, type SqlExecutor, type SqlResult, type SqlRow, type SqlStatement } from "@guild/kernel";
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
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL CHECK(is_active IN (0, 1)), deleted_at TEXT,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_users_role ON users(role_id, deleted_at, is_active);
  CREATE UNIQUE INDEX ux_users_username_nocase ON users(username COLLATE NOCASE);
  CREATE TABLE user_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id), password_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE member_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id), power REAL NOT NULL DEFAULT 0,
    revision_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user_created ON sessions(user_id, created_at, token_digest);
  CREATE TABLE invite_links (
    id TEXT PRIMARY KEY, token_digest TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
    role_id TEXT NOT NULL REFERENCES roles(id), max_uses INTEGER NOT NULL, used_count INTEGER NOT NULL,
    expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE login_failures (username TEXT PRIMARY KEY, fail_count INTEGER NOT NULL, locked_until TEXT, last_failed_at TEXT NOT NULL);
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, actor_username TEXT,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    summary TEXT, detail_json TEXT, occurred_at TEXT NOT NULL
  );
`;

class TestExecutor implements SqlExecutor {
  readonly statements: SqlStatement[] = [];
  beforeNextBatch: (() => void) | undefined;

  constructor(readonly database: DatabaseSync) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    assertSqlStatement(statement);
    this.statements.push(statement);
    return this.run(statement);
  }

  async batch(statements: readonly SqlStatement[]): Promise<readonly SqlResult[]> {
    const before = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    before?.();
    statements.forEach(assertSqlStatement);
    this.statements.push(...statements);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.run(statement));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private run(statement: SqlStatement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    const params = [...(statement.params ?? [])] as SQLInputValue[];
    if (statement.method === "run") {
      const result = prepared.run(...params);
      return { rows: [], lastInsertRowId: result.lastInsertRowid };
    }
    prepared.setReturnArrays(true);
    if (statement.method === "get") return { rows: prepared.get(...params) as unknown as SqlRow | undefined };
    return { rows: prepared.all(...params) as unknown as readonly SqlRow[] };
  }
}

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(BASE_SCHEMA);
  database.exec(readFileSync(fileURLToPath(new URL("../schema/auth-triggers.sql", import.meta.url)), "utf8"));
  const insertRole = database.prepare("INSERT INTO roles (id, name, level, revision_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  insertRole.run("site_owner", "Site Owner", 1000, "site-owner-v1", NOW, NOW);
  insertRole.run("admin", "Admin", 900, "admin-v1", NOW, NOW);
  insertRole.run("member", "Member", 100, "member-v1", NOW, NOW);
  insertRole.run("officer", "Officer", 200, "officer-v1", NOW, NOW);
  database.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('admin', 'admin.roles.manage')").run();
  database.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('site_owner', 'admin.owners.manage')").run();
  const insertUser = database.prepare(`INSERT INTO users (
    id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at
  ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
  insertUser.run("admin-1", "Admin", "admin", 1, "admin-user-v1", NOW, NOW);
  insertUser.run("owner-1", "Owner", "site_owner", 1, "owner-user-v1", NOW, NOW);
  insertUser.run("target-1", "Target One", "member", 1, "target-1-v1", NOW, NOW);
  insertUser.run("target-2", "Target Two", "member", 1, "target-2-v1", NOW, NOW);
  const executor = new TestExecutor(database);
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
  return createAuditMutation(context(), { entityType: "user", entityId, action });
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

describe("SqliteAuthStore guarded mutations", () => {
  it("bounds the role catalog and keeps direct role lookup bounded", async () => {
    const value = harness();
    const insertRole = value.database.prepare(
      "INSERT INTO roles (id, name, level, revision_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (let index = 0; index < 46; index += 1) {
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
    }, createAuditMutation(context(), {
      entityType: "role",
      entityId: "overflow",
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

  it("keeps the last active site owner and rolls back its audit", async () => {
    const value = harness();
    const [owner] = await value.store.findManagedUsers(["owner-1"]);
    await expect(value.store.setUsersActive({ targets: [owner!], active: false, now: NOW }, audit("owner-1", "deactivate")))
      .resolves.toBe("last_owner");
    expect(scalar(value.database, "SELECT is_active FROM users WHERE id = 'owner-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("rolls back role metadata and audit when the site-owner permission trigger aborts", async () => {
    const value = harness();
    const role = await value.store.findRole("site_owner");
    const result = await value.store.updateRole({
      id: role!.id,
      name: "Renamed",
      permissionDelta: { add: [], remove: ["admin.owners.manage"] },
      expectedRevisionToken: role!.revisionToken,
      expectedPermissions: [...role!.permissions],
      now: NOW,
    }, createAuditMutation(context(), { entityType: "role", entityId: "site_owner", action: "update" }));
    expect(result).toBe("last_owner");
    expect(value.database.prepare("SELECT name FROM roles WHERE id = 'site_owner'").get()).toMatchObject({ name: "Site Owner" });
    expect(scalar(value.database, "SELECT count(*) FROM role_permissions WHERE permission = 'admin.owners.manage'")).toBe(1);
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
    const registrationAudit = createAuditMutation(context(), {
      entityType: "user", entityId: "registered-1", action: "register",
    });

    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-1",
      tokenDigest: "digest-1",
      userId: "registered-1",
      username: "Registered One",
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
      username: "Managed One",
      roleId: "member",
      passwordHash: "managed-hash",
      destinationRole: destinationRole!,
      now: NOW,
    }, createAuditMutation(context(), {
      entityType: "user", entityId: "managed-1", action: "admin_create_member",
    }))).resolves.toBe("created");
    expect(scalar(value.database, "SELECT count(*) FROM user_credentials WHERE user_id = 'managed-1'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM member_profiles WHERE user_id = 'managed-1'")).toBe(1);
  });

  it("rolls back invite use, account, credentials, and profile when the final audit write fails", async () => {
    const value = harness();
    value.database.prepare(`INSERT INTO invite_links (
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-rollback', 'digest-rollback', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    const duplicateAudit = createAuditMutation(context(), {
      entityType: "user", entityId: "rollback-user", action: "register",
    });
    value.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_user_id, entity_type, entity_id, action, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      duplicateAudit.id,
      duplicateAudit.requestId,
      duplicateAudit.actorUserId,
      duplicateAudit.entityType,
      duplicateAudit.entityId,
      duplicateAudit.action,
      duplicateAudit.occurredAt,
    );

    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-rollback",
      tokenDigest: "digest-rollback",
      userId: "rollback-user",
      username: "Rollback User",
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
  it("uses an exact id predicate for decoded invite codes", async () => {
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
      exactId: "invite-target",
      now: NOW,
    })).resolves.toMatchObject({ data: [{ id: "invite-target" }], total: 1 });
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
    value.database.prepare("INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES ('target-1', ?, ?)")
      .run(passwordHash, NOW);
    const auth = new AuthService({
      store: value.store,
      provisioning: value.provisioning,
      profiles: { readOwnProfile: async () => null },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(auth.login({ username: "Target One", password: "wrong", stayLoggedIn: false, now: NOW }))
        .rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    }
    await expect(auth.login({ username: "Target One", password: "wrong", stayLoggedIn: false, now: NOW }))
      .rejects.toMatchObject({
        code: "RATE_LIMITED",
        status: 429,
        details: { retry_after_seconds: 30, locked_until: "2026-08-09T12:00:30.000Z" },
      });
    await expect(auth.login({
      username: "Target One", password: "still-wrong", stayLoggedIn: false, now: "2026-08-09T12:00:10.000Z",
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retry_after_seconds: 20, locked_until: "2026-08-09T12:00:30.000Z" },
    });
    expect(scalar(value.database, "SELECT fail_count FROM login_failures WHERE username = 'target one'")).toBe(4);

    await expect(auth.login({
      username: "Target One", password: "wrong", stayLoggedIn: false, now: "2026-08-09T12:00:30.000Z",
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      details: { retry_after_seconds: 60, locked_until: "2026-08-09T12:01:30.000Z" },
    });
  });

  it("keeps unknown and real usernames on the same persistent failure response path", async () => {
    const value = harness();
    value.database.prepare("INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES ('target-1', ?, ?)")
      .run(await createPasswordHash("correct-password"), NOW);
    const auth = new AuthService({
      store: value.store,
      provisioning: value.provisioning,
      profiles: { readOwnProfile: async () => null },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });
    const capture = async (username: string) => {
      try {
        await auth.login({ username, password: "wrong", stayLoggedIn: false, now: NOW });
      } catch (error) {
        return error;
      }
      throw new Error("Expected login rejection");
    };
    expect(await capture("Target One")).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    expect(await capture("Unknown User")).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    expect(value.database.prepare(
      "SELECT username, fail_count FROM login_failures ORDER BY username",
    ).all()).toEqual([
      { username: "target one", fail_count: 1 },
      { username: "unknown user", fail_count: 1 },
    ]);
  });

  it("reads and atomically resets the previous state, including an explicit empty state", async () => {
    const value = harness();
    value.database.prepare(
      "INSERT INTO login_failures (username, fail_count, locked_until, last_failed_at) VALUES ('target one', 6, '2026-08-09T12:05:00.000Z', ?)",
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

    await expect(admin.resetLoginLock(passwordAdminContext(), "target-1")).resolves.toEqual({
      ok: true, failCount: 0, lockedUntil: null, isLocked: false, retryAfterSeconds: 0,
    });
    expect(scalar(value.database, "SELECT count(*) FROM audit_log WHERE action = 'reset_login_lock'")).toBe(2);
  });

  it("rejects a raced target revision without deleting the lock or writing audit", async () => {
    const value = harness();
    value.database.prepare(
      "INSERT INTO login_failures (username, fail_count, locked_until, last_failed_at) VALUES ('target one', 4, '2026-08-09T12:00:30.000Z', ?)",
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
    expect(scalar(value.database, "SELECT count(*) FROM login_failures WHERE username = 'target one'")).toBe(1);
    expect(scalar(value.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("bounds stale failure pruning", async () => {
    const value = harness();
    const insert = value.database.prepare(
      "INSERT INTO login_failures (username, fail_count, locked_until, last_failed_at) VALUES (?, 1, NULL, '2026-08-01T00:00:00.000Z')",
    );
    for (let index = 0; index < 150; index += 1) insert.run(`stale-${String(index).padStart(3, "0")}`);
    await value.store.pruneLoginFailures("2026-08-08T00:00:00.000Z", NOW, 100);
    expect(scalar(value.database, "SELECT count(*) FROM login_failures")).toBe(50);
  });
});

describe("SqliteAuthStore query plan", () => {
  it("uses the NOCASE username index for every authentication and provisioning lookup", async () => {
    const value = harness();
    value.database.prepare(
      "INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES ('target-1', 'hash', ?)",
    ).run(NOW);

    const lookupStart = value.executor.statements.length;
    await expect(value.store.findLoginAccount("target one")).resolves.toMatchObject({ username: "Target One" });
    await expect(value.store.usernameExists("target one")).resolves.toBe(true);
    const lookupStatements = value.executor.statements.slice(lookupStart);

    value.database.prepare(`INSERT INTO invite_links (
      id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
    ) VALUES ('invite-duplicate', 'digest-duplicate', 'admin-1', 'member', 1, 0, NULL, ?, NULL)`).run(NOW);
    await expect(value.provisioning.redeemInviteAndCreateMember({
      inviteId: "invite-duplicate",
      tokenDigest: "digest-duplicate",
      userId: "duplicate-user",
      username: "TARGET ONE",
      passwordHash: "hash",
      now: NOW,
    }, createAuditMutation(context(), {
      entityType: "user", entityId: "duplicate-user", action: "register",
    }))).resolves.toBe("username_taken");
    const provisioningLookup = value.executor.statements.at(-1)!;

    for (const statement of [...lookupStatements, provisioningLookup]) {
      const rows = value.database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
        .all(...[...(statement.params ?? [])] as SQLInputValue[]) as Array<{ detail: string }>;
      expect(rows.map(({ detail }) => detail).join("\n")).toContain("ux_users_username_nocase");
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
