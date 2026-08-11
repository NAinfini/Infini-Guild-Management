import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPasswordHash, verifyPassword } from "@guild/server/modules/auth";
import { buildSiteOwnerBootstrapBundle } from "./site-owner-bootstrap";

const migrationPath = fileURLToPath(new URL(
  "../../packages/persistence-sqlite/src/migrations/generated/0000_core.sql",
  import.meta.url,
));

function freshDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(readFileSync(migrationPath, "utf8").replaceAll("--> statement-breakpoint", ""));
  return database;
}

function applyAtomically(database: DatabaseSync, sql: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

describe("site owner bootstrap", () => {
  it("creates the first owner with a verifiable password and complete profile", async () => {
    const database = freshDatabase();
    const hash = await createPasswordHash("correct horse battery staple", 10_000);
    const bundle = buildSiteOwnerBootstrapBundle({
      mode: "create",
      userId: "owner-1",
      username: "Owner_1",
      passwordHash: hash,
      nonce: "create-owner-0001",
    });

    applyAtomically(database, bundle.sql);
    const user = database.prepare("SELECT role_id, is_active, deleted_at FROM users WHERE id = ?").get("owner-1") as Record<string, unknown>;
    const stored = database.prepare("SELECT password_hash FROM user_credentials WHERE user_id = ?").get("owner-1") as { password_hash: string };
    expect(user).toEqual({ role_id: "site_owner", is_active: 1, deleted_at: null });
    expect(database.prepare("SELECT count(*) AS count FROM member_profiles WHERE user_id = ?").get("owner-1")).toEqual({ count: 1 });
    expect(await verifyPassword("correct horse battery staple", stored.password_hash)).toBe(true);
    expect(database.prepare("SELECT action, actor_user_id, actor_username FROM audit_log WHERE entity_id = ?").get("owner-1")).toEqual({
      action: "init",
      actor_user_id: "owner-1",
      actor_username: "Owner_1",
    });
    database.close();
  });

  it("promotes one explicit active user without changing their credential", async () => {
    const database = freshDatabase();
    database.prepare(`INSERT INTO users (id, username, role_id, is_active, deleted_at, revision_token)
      VALUES (?, ?, 'member', 1, NULL, ?)`).run("member-1", "Member_1", "member-revision-0001");
    database.prepare("INSERT INTO member_profiles (user_id, revision_token) VALUES (?, ?)")
      .run("member-1", "profile-revision-0001");
    database.prepare("INSERT INTO user_credentials (user_id, password_hash) VALUES (?, ?)")
      .run("member-1", "pbkdf2-sha256$10000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    applyAtomically(database, buildSiteOwnerBootstrapBundle({
      mode: "promote",
      userId: "member-1",
      nonce: "promote-owner-0001",
    }).sql);
    expect(database.prepare("SELECT role_id FROM users WHERE id = ?").get("member-1")).toEqual({ role_id: "site_owner" });
    expect(database.prepare("SELECT count(*) AS count FROM user_credentials WHERE user_id = ?").get("member-1")).toEqual({ count: 1 });
    database.close();
  });

  it("rolls back when an active owner already exists or the promote target is unavailable", async () => {
    const database = freshDatabase();
    const hash = await createPasswordHash("first-owner-password", 10_000);
    applyAtomically(database, buildSiteOwnerBootstrapBundle({
      mode: "create",
      userId: "owner-1",
      username: "Owner_1",
      passwordHash: hash,
      nonce: "owner-one-0001",
    }).sql);

    expect(() => applyAtomically(database, buildSiteOwnerBootstrapBundle({
      mode: "create",
      userId: "owner-2",
      username: "Owner_2",
      passwordHash: hash,
      nonce: "owner-two-0001",
    }).sql)).toThrow();
    expect(database.prepare("SELECT count(*) AS count FROM users WHERE id = 'owner-2'").get()).toEqual({ count: 0 });
    database.close();

    const missingTargetDatabase = freshDatabase();
    expect(() => applyAtomically(missingTargetDatabase, buildSiteOwnerBootstrapBundle({
      mode: "promote",
      userId: "missing-user",
      nonce: "missing-owner-0001",
    }).sql)).toThrow();
    expect(missingTargetDatabase.prepare("SELECT count(*) AS count FROM audit_log WHERE entity_id = 'missing-user'").get()).toEqual({ count: 0 });
    missingTargetDatabase.close();
  });
});
