import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteEmailVerificationStore } from "./email-verification-store.js";

const NOW = "2026-08-22T12:00:00.000Z";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function harness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
    CREATE TABLE user_credentials (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      auth_revision INTEGER NOT NULL
    );
    CREATE TABLE user_emails (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      normalized_email TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX ux_user_emails_normalized_email_nocase
      ON user_emails(normalized_email COLLATE NOCASE);
    CREATE TABLE email_verification_challenges (
      token_digest TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pending_email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      sent_count INTEGER NOT NULL CHECK(sent_count >= 1),
      last_sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL, actor_label TEXT, subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL, subject_label TEXT, action TEXT NOT NULL,
      payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    INSERT INTO users VALUES ('user-1', 'One'), ('user-2', 'Two');
    INSERT INTO user_credentials VALUES ('user-1', 1), ('user-2', 1);
  `);
  return { database, store: new SqliteEmailVerificationStore(new SqliteTestExecutor(database)) };
}

function audit(userId: string) {
  const context = createRequestContext({
    requestId: `request-${userId}`,
    now: NOW,
    authorization: createAuthorizationContext({
      userId,
      sessionId: `session-${userId}`,
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
  });
  return createAuditEvent(context, {
    subjectType: "user_auth",
    subjectId: userId,
    action: "update",
  });
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

describe("SqliteEmailVerificationStore", () => {
  it("consumes a verification token once even when a replay uses the same timestamp", async () => {
    const { database, store } = harness();
    await expect(store.createChallenge({
      tokenDigest: "digest-1",
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "one@example.com",
      expiresAt: "2026-08-22T12:30:00.000Z",
      now: NOW,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    })).resolves.toBe(true);

    const input = { tokenDigest: "digest-1", userId: "user-1", now: NOW, audit: audit("user-1") };
    await expect(store.verify(input)).resolves.toBe("verified");
    await expect(store.verify({ ...input, audit: audit("user-1") })).resolves.toBe("invalid");

    await expect(store.getVerifiedEmail("user-1")).resolves.toBe("one@example.com");
    expect(count(database, "audit_log")).toBe(1);
  });

  it("keeps a conflicting email challenge unconsumed and does not audit it", async () => {
    const { database, store } = harness();
    database.prepare(
      "INSERT INTO user_emails VALUES ('user-1', 'shared@example.com', ?, ?, ?)",
    ).run(NOW, NOW, NOW);
    await store.createChallenge({
      tokenDigest: "digest-2",
      userId: "user-2",
      expectedAuthRevision: 1,
      pendingEmail: "SHARED@example.com",
      expiresAt: "2026-08-22T12:30:00.000Z",
      now: NOW,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    });

    await expect(store.verify({
      tokenDigest: "digest-2",
      userId: "user-2",
      now: NOW,
      audit: audit("user-2"),
    })).resolves.toBe("email_taken");
    const row = database.prepare(
      "SELECT consumed_at FROM email_verification_challenges WHERE token_digest = 'digest-2'",
    ).get() as { consumed_at: string | null };
    expect(row.consumed_at).toBeNull();
    expect(count(database, "audit_log")).toBe(0);
  });

  it("enforces the persistent three-send window across replacement challenges", async () => {
    const { store } = harness();
    for (let index = 0; index < 3; index += 1) {
      const now = new Date(Date.parse(NOW) + index * 61_000).toISOString();
      await expect(store.createChallenge({
        tokenDigest: `digest-${index}`,
        userId: "user-1",
        expectedAuthRevision: 1,
        pendingEmail: "one@example.com",
        expiresAt: new Date(Date.parse(now) + 30 * 60_000).toISOString(),
        now,
        maximumSendsInWindow: 3,
        sendWindowSeconds: 3_600,
      })).resolves.toBe(true);
    }
    const fourth = new Date(Date.parse(NOW) + 3 * 61_000).toISOString();
    await expect(store.createChallenge({
      tokenDigest: "digest-4",
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "one@example.com",
      expiresAt: new Date(Date.parse(fourth) + 30 * 60_000).toISOString(),
      now: fourth,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    })).resolves.toBe(false);
  });

  it("invalidates a failed send without deleting its persistent window count", async () => {
    const { database, store } = harness();
    await store.createChallenge({
      tokenDigest: "failed-send",
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "one@example.com",
      expiresAt: "2026-08-22T12:30:00.000Z",
      now: NOW,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    });
    await store.invalidateChallenge("failed-send", NOW);

    expect(database.prepare(`SELECT sent_count, consumed_at
      FROM email_verification_challenges WHERE token_digest = 'failed-send'`).get()).toEqual({
      sent_count: 1,
      consumed_at: NOW,
    });
  });

  it("applies matching credential revisions to resend and verified-email removal", async () => {
    const { database, store } = harness();
    const later = "2026-08-22T12:01:01.000Z";
    await store.createChallenge({
      tokenDigest: "first-digest",
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "one@example.com",
      expiresAt: "2026-08-22T12:30:00.000Z",
      now: NOW,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    });

    await expect(store.reserveResend({
      userId: "user-1",
      expectedAuthRevision: 1,
      nextTokenDigest: "second-digest",
      now: later,
      minimumIntervalSeconds: 60,
      maximumSends: 3,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    })).resolves.toMatchObject({ tokenDigest: "second-digest", sentCount: 2 });
    database.prepare(
      "INSERT INTO user_emails VALUES ('user-1', 'verified@example.com', ?, ?, ?)",
    ).run(NOW, NOW, NOW);

    await expect(store.removeVerifiedEmail({
      userId: "user-1",
      expectedAuthRevision: 1,
      audit: audit("user-1"),
    })).resolves.toBe(true);

    expect(count(database, "user_emails")).toBe(0);
    expect(count(database, "email_verification_challenges")).toBe(0);
    expect(count(database, "audit_log")).toBe(1);
  });

  it("leaves email writes and audits untouched when the verified credential revision is stale", async () => {
    const { database, store } = harness();
    const later = "2026-08-22T12:01:01.000Z";
    await expect(store.createChallenge({
      tokenDigest: "active-digest",
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "one@example.com",
      expiresAt: "2026-08-22T12:30:00.000Z",
      now: NOW,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    })).resolves.toBe(true);
    database.prepare(
      "INSERT INTO user_emails VALUES ('user-1', 'verified@example.com', ?, ?, ?)",
    ).run(NOW, NOW, NOW);
    database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'user-1'").run();

    await expect(store.createChallenge({
      tokenDigest: "stale-create",
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "new@example.com",
      expiresAt: "2026-08-22T12:31:01.000Z",
      now: later,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    })).resolves.toBe(false);
    await expect(store.reserveResend({
      userId: "user-1",
      expectedAuthRevision: 1,
      nextTokenDigest: "stale-resend",
      now: later,
      minimumIntervalSeconds: 60,
      maximumSends: 3,
      maximumSendsInWindow: 3,
      sendWindowSeconds: 3_600,
    })).resolves.toBeNull();
    await expect(store.removeVerifiedEmail({
      userId: "user-1",
      expectedAuthRevision: 1,
      audit: audit("user-1"),
    })).resolves.toBe(false);

    expect(database.prepare(`SELECT token_digest, consumed_at FROM email_verification_challenges
      WHERE user_id = 'user-1'`).get()).toEqual({ token_digest: "active-digest", consumed_at: null });
    expect(database.prepare("SELECT normalized_email FROM user_emails WHERE user_id = 'user-1'").get())
      .toEqual({ normalized_email: "verified@example.com" });
    expect(count(database, "audit_log")).toBe(0);
  });
});
