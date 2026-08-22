import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPasswordHash, verifyPassword } from "@guild/server/modules/auth";
import { buildFirstAdminBootstrapBundle } from "./first-admin-bootstrap";

const migrationDirectory = resolve(process.cwd(), "packages/persistence-sqlite/src/migrations/generated");
const migrationManifest = JSON.parse(readFileSync(resolve(migrationDirectory, "manifest.json"), "utf8")) as Array<{
  file: string;
}>;

function freshDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const { file } of migrationManifest) {
    database.exec(readFileSync(resolve(migrationDirectory, file), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
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

describe("first admin bootstrap", () => {
  it("creates the first role manager with a verifiable password and complete profile", async () => {
    const database = freshDatabase();
    const hash = await createPasswordHash("correct horse battery staple", 10_000);
    const bundle = buildFirstAdminBootstrapBundle({
      mode: "create",
      userId: "admin-1",
      username: "Admin_1",
      passwordHash: hash,
      nonce: "create-admin-0001",
    });

    applyAtomically(database, bundle.sql);
    const user = database.prepare("SELECT role_id, is_active, deleted_at FROM users WHERE id = ?").get("admin-1") as Record<string, unknown>;
    const stored = database.prepare("SELECT password_hash FROM user_credentials WHERE user_id = ?").get("admin-1") as { password_hash: string };
    expect(user).toEqual({ role_id: "admin", is_active: 1, deleted_at: null });
    expect(database.prepare("SELECT count(*) AS count FROM member_profiles WHERE user_id = ?").get("admin-1")).toEqual({ count: 1 });
    expect(await verifyPassword("correct horse battery staple", stored.password_hash)).toBe(true);
    expect(database.prepare(`SELECT action, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, payload_json FROM audit_log WHERE subject_id = ?`).get("admin-1")).toEqual({
      action: "init",
      actor_kind: "user",
      actor_id: "admin-1",
      actor_label: "Admin_1",
      subject_type: "user",
      subject_id: "admin-1",
      subject_label: "Admin_1",
      payload_json: JSON.stringify({
        schema_version: 2,
        changes: [],
        context: [{ field: "role_id", value: { type: "code", value: "admin" } }],
      }),
    });
    database.close();
  });

  it("promotes one explicit active user without changing their credential", () => {
    const database = freshDatabase();
    database.prepare(`INSERT INTO users (id, username, role_id, is_active, deleted_at, revision_token)
      VALUES (?, ?, 'member', 1, NULL, ?)`).run("member-1", "Member_1", "member-revision-0001");
    database.prepare("INSERT INTO member_profiles (user_id, revision_token) VALUES (?, ?)")
      .run("member-1", "profile-revision-0001");
    database.prepare("INSERT INTO user_credentials (user_id, password_hash) VALUES (?, ?)")
      .run("member-1", "pbkdf2-sha256$10000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    applyAtomically(database, buildFirstAdminBootstrapBundle({
      mode: "promote",
      userId: "member-1",
      nonce: "promote-admin-0001",
    }).sql);
    expect(database.prepare("SELECT role_id FROM users WHERE id = ?").get("member-1")).toEqual({ role_id: "admin" });
    expect(database.prepare("SELECT count(*) AS count FROM user_credentials WHERE user_id = ?").get("member-1")).toEqual({ count: 1 });
    database.close();
  });

  it("rolls back when an active role manager already exists or the promote target is unavailable", async () => {
    const database = freshDatabase();
    const hash = await createPasswordHash("first-admin-password", 10_000);
    applyAtomically(database, buildFirstAdminBootstrapBundle({
      mode: "create",
      userId: "admin-1",
      username: "Admin_1",
      passwordHash: hash,
      nonce: "admin-one-0001",
    }).sql);

    expect(() => applyAtomically(database, buildFirstAdminBootstrapBundle({
      mode: "create",
      userId: "admin-2",
      username: "Admin_2",
      passwordHash: hash,
      nonce: "admin-two-0001",
    }).sql)).toThrow();
    expect(database.prepare("SELECT count(*) AS count FROM users WHERE id = 'admin-2'").get()).toEqual({ count: 0 });
    database.close();

    const missingTargetDatabase = freshDatabase();
    expect(() => applyAtomically(missingTargetDatabase, buildFirstAdminBootstrapBundle({
      mode: "promote",
      userId: "missing-user",
      nonce: "missing-admin-0001",
    }).sql)).toThrow();
    expect(missingTargetDatabase.prepare("SELECT count(*) AS count FROM audit_log WHERE subject_id = 'missing-user'").get()).toEqual({ count: 0 });
    missingTargetDatabase.close();
  });
});
