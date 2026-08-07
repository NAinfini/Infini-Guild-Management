import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigration, migrationSql } from "./migration-test-utils";

type Row = Record<string, unknown>;

function rows(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as Row[];
}

function redeemInvite(
  db: DatabaseSync,
  code: string,
  userId: string,
  username: string,
  profileUserId = userId,
): void {
  db.exec("BEGIN;");
  try {
    db.prepare(
      `UPDATE invite_links SET used_count = used_count + 1
       WHERE code = ? AND revoked_at IS NULL AND used_count < max_uses
         AND (expires_at IS NULL OR expires_at > ?)
       RETURNING id, role_id`,
    ).all(code, "2026-08-05T00:00:00.000Z");
    db.prepare(
      `INSERT INTO users (id, username, role, is_active)
       VALUES (?, ?, (SELECT role_id FROM invite_links WHERE code = ? AND changes() = 1), 1)`,
    ).run(userId, username, code);
    db.prepare(
      "INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (?, ?, ?)",
    ).run(userId, "hash", "salt");
    db.prepare(
      "INSERT INTO member_profiles (id, user_id, power, video_urls) VALUES (?, ?, 0, '[]')",
    ).run(`profile-${userId}`, profileUserId);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

describe("role authority schema upgrade", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("preserves production-shaped invites while assigning the member seed role", () => {
    const roleMigration = migrationSql.find(({ file }) => file === "0002_dynamic_role_authority.sql");
    expect(roleMigration, "missing immutable 0002 role migration").toBeDefined();
    if (!roleMigration) return;

    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    for (const migration of migrationSql.filter(({ file }) => file < roleMigration.file)) {
      applyMigration(db, migration.sql);
    }

    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)")
      .run("creator-1", "Creator", "admin");
    db.prepare(
      `INSERT INTO invite_links
        (id, code, created_by, max_uses, used_count, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "invite-1",
      "PRESERVE-ME",
      "creator-1",
      7,
      3,
      "2027-01-01T00:00:00.000Z",
      "2026-08-05T01:02:03.000Z",
      "2026-08-06T01:02:03.000Z",
    );

    applyMigration(db, roleMigration.sql);

    expect(rows(db, "PRAGMA table_info(roles)").map((row) => row.name)).not.toContain("is_builtin");
    expect(rows(db, "PRAGMA table_info(invite_links)").map((row) => row.name)).toContain("role_id");
    expect(db.prepare(
      `SELECT id, code, created_by, role_id, max_uses, used_count,
              expires_at, created_at, revoked_at
       FROM invite_links WHERE id = 'invite-1'`,
    ).get()).toEqual({
      id: "invite-1",
      code: "PRESERVE-ME",
      created_by: "creator-1",
      role_id: "member",
      max_uses: 7,
      used_count: 3,
      expires_at: "2027-01-01T00:00:00.000Z",
      created_at: "2026-08-05T01:02:03.000Z",
      revoked_at: "2026-08-06T01:02:03.000Z",
    });
    expect(rows(db, "SELECT id, name FROM roles WHERE id IN ('admin', 'moderator', 'member') ORDER BY level DESC"))
      .toEqual([
        { id: "admin", name: "Admin" },
        { id: "moderator", name: "Moderator" },
        { id: "member", name: "Member" },
      ]);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("restricts deleting a role referenced by an invite", () => {
    const roleMigration = migrationSql.find(({ file }) => file === "0002_dynamic_role_authority.sql");
    expect(roleMigration, "missing immutable 0002 role migration").toBeDefined();
    if (!roleMigration) return;

    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    for (const migration of migrationSql) applyMigration(db, migration.sql);
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)")
      .run("creator-1", "Creator", "admin");
    db.prepare(
      "INSERT INTO invite_links (id, code, created_by, role_id, max_uses) VALUES (?, ?, ?, ?, ?)",
    ).run("invite-1", "ROLE-REF", "creator-1", "member", 1);

    expect(() => db!.prepare("DELETE FROM roles WHERE id = 'member'").run())
      .toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rolls back invite capacity on zero-row, unique-user, and foreign-key failures", () => {
    expect(migrationSql.at(-1)?.file).toBe("0002_dynamic_role_authority.sql");
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    for (const migration of migrationSql) applyMigration(db, migration.sql);
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)")
      .run("creator-1", "Creator", "admin");
    db.prepare(
      "INSERT INTO invite_links (id, code, created_by, role_id, max_uses) VALUES (?, ?, ?, ?, ?)",
    ).run("invite-capacity", "ONE-SEAT", "creator-1", "member", 1);

    redeemInvite(db, "ONE-SEAT", "winner-1", "Winner");
    expect(() => redeemInvite(db!, "ONE-SEAT", "loser-1", "Loser"))
      .toThrow(/NOT NULL constraint failed: users\.role/i);
    expect(db.prepare("SELECT used_count FROM invite_links WHERE id = 'invite-capacity'").get())
      .toEqual({ used_count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id IN ('winner-1', 'loser-1')").get())
      .toEqual({ count: 1 });

    db.prepare(
      "INSERT INTO invite_links (id, code, created_by, role_id, max_uses) VALUES (?, ?, ?, ?, ?)",
    ).run("invite-unique", "UNIQUE-ROLLBACK", "creator-1", "member", 1);
    expect(() => redeemInvite(db!, "UNIQUE-ROLLBACK", "duplicate-1", "Creator"))
      .toThrow(/UNIQUE constraint failed: users\.username/i);
    expect(db.prepare("SELECT used_count FROM invite_links WHERE id = 'invite-unique'").get())
      .toEqual({ used_count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'duplicate-1'").get())
      .toEqual({ count: 0 });

    db.prepare(
      "INSERT INTO invite_links (id, code, created_by, role_id, max_uses) VALUES (?, ?, ?, ?, ?)",
    ).run("invite-fk", "FK-ROLLBACK", "creator-1", "member", 1);
    expect(() => redeemInvite(db!, "FK-ROLLBACK", "fk-user", "ForeignKey", "missing-user"))
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(db.prepare("SELECT used_count FROM invite_links WHERE id = 'invite-fk'").get())
      .toEqual({ used_count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'fk-user'").get())
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM user_auth_password WHERE user_id = 'fk-user'").get())
      .toEqual({ count: 0 });
  });
});
