import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { APPLICATION_MIGRATION_SQL } from "../testing/application-migrations.js";
import { applyPrivateVpsMigration } from "./private-vps-migration.js";

const migration = APPLICATION_MIGRATION_SQL.replaceAll("--> statement-breakpoint", "");
const databases: DatabaseSync[] = [];

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("private VPS migration", () => {
  it("applies SQL atomically only to the current shared schema", () => {
    const database = freshDatabase();
    expect(applyPrivateVpsMigration(database, "CREATE TABLE private_marker (value TEXT NOT NULL); INSERT INTO private_marker VALUES ('ok');"))
      .toBe("applied");
    expect(database.prepare("SELECT value FROM private_marker").get()).toEqual({ value: "ok" });
  });

  it("rolls back SQL failures and foreign-key violations", () => {
    const database = freshDatabase();
    expect(() => applyPrivateVpsMigration(database,
      "CREATE TABLE private_marker (value TEXT NOT NULL); INSERT INTO private_marker VALUES ('ok'); SELECT * FROM missing;",
    )).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'private_marker'").get()).toBeUndefined();

    expect(() => applyPrivateVpsMigration(database,
      "PRAGMA defer_foreign_keys = ON; INSERT INTO member_profiles (user_id, revision_token) VALUES ('missing', 'missing-profile-revision');",
    )).toThrow(/foreign-key/i);
    expect(database.prepare("SELECT user_id FROM member_profiles WHERE user_id = 'missing'").get()).toBeUndefined();
  });

  it("rejects transaction control and a mismatched schema before mutation", () => {
    const database = freshDatabase();
    expect(() => applyPrivateVpsMigration(database, "/* hidden */ BEGIN; CREATE TABLE private_marker (value TEXT); COMMIT;"))
      .toThrow(/transaction control/i);

    database.exec("DROP TRIGGER app_migrations_immutable_update");
    database.prepare("UPDATE app_migrations SET checksum = ? WHERE ordinal = 0").run("0".repeat(64));
    expect(() => applyPrivateVpsMigration(database, "CREATE TABLE private_marker (value TEXT);"))
      .toThrow(/schema mismatch/i);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'private_marker'").get()).toBeUndefined();
  });
});

function freshDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(migration);
  return database;
}
