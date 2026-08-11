import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@guild/server/modules/auth";
import { buildLegacyCredentialImportBundle } from "./credential-import.js";

const SALT = "ABEiM0RVZneImaq7zN3u/w==";
const HASH = "EmkuNs85llMvx54FsKZiwKLn4lfvjY7uswwxuzCil0c=";
const migration = readFileSync(fileURLToPath(new URL(
  "../../packages/persistence-sqlite/src/migrations/generated/0000_core.sql",
  import.meta.url,
)), "utf8").replaceAll("--> statement-breakpoint", "");
const databases: DatabaseSync[] = [];

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("legacy credential import bundle", () => {
  it("ports exact password material into the sole runtime format", async () => {
    const database = freshDatabase();
    insertUser(database, "user-1", "Member");
    const bundle = buildLegacyCredentialImportBundle([legacy("user-1")]);

    applyAtomically(database, bundle.sql);

    const encoded = (database.prepare("SELECT password_hash FROM user_credentials WHERE user_id = ?")
      .get("user-1") as { password_hash: string }).password_hash;
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_ig_credential_import_%'").all())
      .toEqual([]);
  });

  it("fails the complete batch when any target user is missing", () => {
    const database = freshDatabase();
    insertUser(database, "user-1", "Member");
    const bundle = buildLegacyCredentialImportBundle([legacy("user-1"), legacy("missing")]);

    expect(() => applyAtomically(database, bundle.sql)).toThrow(/constraint/i);

    expect(database.prepare("SELECT count(*) AS count FROM user_credentials").get()).toMatchObject({ count: 0 });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_ig_credential_import_%'").all())
      .toEqual([]);
  });

  it("rejects duplicates, extra fields, and malformed legacy material before SQL exists", () => {
    expect(() => buildLegacyCredentialImportBundle([legacy("same"), legacy("same")])).toThrow(/duplicate/i);
    expect(() => buildLegacyCredentialImportBundle([{ ...legacy("user"), password: "secret" }]))
      .toThrow();
    expect(() => buildLegacyCredentialImportBundle([{ ...legacy("user"), salt: "not-base64" }]))
      .toThrow();
  });

  it("quotes hostile identifiers without changing SQL structure", () => {
    const bundle = buildLegacyCredentialImportBundle([legacy("x'); DROP TABLE users; --")]);
    expect(bundle.sql).toContain("x''); DROP TABLE users; --");
    const database = freshDatabase();
    expect(() => applyAtomically(database, bundle.sql)).toThrow(/constraint/i);
    expect(database.prepare("SELECT count(*) AS count FROM users").get()).toMatchObject({ count: 0 });
  });
});

function legacy(userId: string) {
  return {
    user_id: userId,
    password_hash: `pbkdf2-sha256$10000$${HASH}`,
    salt: SALT,
  };
}

function freshDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(migration);
  return database;
}

function insertUser(database: DatabaseSync, id: string, username: string): void {
  database.prepare(`INSERT INTO users
    (id, username, role_id, revision_token) VALUES (?, ?, 'member', ?)`)
    .run(id, username, `credential-import-${id}-revision`);
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
