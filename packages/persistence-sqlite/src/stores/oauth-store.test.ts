import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteOAuthStore } from "./oauth-store.js";

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
      auth_revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE sessions (
      token_digest TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      auth_revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE external_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      UNIQUE(provider, provider_subject),
      UNIQUE(user_id, provider)
    );
    CREATE TABLE oauth_challenges (
      state_digest TEXT PRIMARY KEY,
      browser_binding_digest TEXT NOT NULL,
      provider TEXT NOT NULL,
      purpose TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      nonce TEXT,
      pkce_verifier TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      auth_revision INTEGER
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL, actor_label TEXT, subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL, subject_label TEXT, action TEXT NOT NULL,
      payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    INSERT INTO users VALUES ('user-1', 'One'), ('user-2', 'Two');
    INSERT INTO user_credentials (user_id) VALUES ('user-1'), ('user-2');
  `);
  return { database, store: new SqliteOAuthStore(new SqliteTestExecutor(database)) };
}

function audit(userId: string, eventId: string) {
  const context = createRequestContext({
    requestId: `request-${eventId}`,
    now: NOW,
    authorization: createAuthorizationContext({
      userId,
      sessionId: `session-${userId}`,
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
  });
  return {
    ...createAuditEvent(context, {
    subjectType: "user_auth",
    subjectId: userId,
    action: "update",
    }),
    eventId,
  };
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

describe("SqliteOAuthStore", () => {
  it("consumes state once and prunes completed challenges on the next start", async () => {
    const { database, store } = harness();
    await store.createChallenge({
      stateDigest: "state-1",
      browserBindingDigest: "browser-1",
      provider: "discord",
      purpose: "login",
      userId: null,
      nonce: null,
      pkceVerifier: null,
      authRevision: null,
      expiresAt: "2026-08-22T12:10:00.000Z",
      createdAt: NOW,
    });
    await expect(store.consumeChallenge("state-1", "wrong-browser", "discord", NOW)).resolves.toBeNull();
    await expect(store.consumeChallenge("state-1", "browser-1", "discord", NOW)).resolves.toMatchObject({
      stateDigest: "state-1",
      purpose: "login",
    });
    await expect(store.consumeChallenge("state-1", "browser-1", "discord", NOW)).resolves.toBeNull();

    await store.createChallenge({
      stateDigest: "state-2",
      browserBindingDigest: "browser-2",
      provider: "discord",
      purpose: "login",
      userId: null,
      nonce: null,
      pkceVerifier: null,
      authRevision: null,
      expiresAt: "2026-08-22T12:10:00.000Z",
      createdAt: NOW,
    });
    expect(count(database, "oauth_challenges")).toBe(1);
  });

  it("maps one external subject to one account while allowing multiple providers", async () => {
    const { database, store } = harness();
    await expect(store.linkIdentity({
      id: "identity-google",
      userId: "user-1",
      provider: "google",
      providerSubject: "google-subject",
      now: NOW,
      expectedAuthRevision: 1,
      audit: audit("user-1", "audit-google"),
    })).resolves.toBe("linked");
    await expect(store.linkIdentity({
      id: "identity-google-repeat",
      userId: "user-1",
      provider: "google",
      providerSubject: "google-subject",
      now: NOW,
      expectedAuthRevision: 1,
      audit: audit("user-1", "audit-repeat"),
    })).resolves.toBe("already_linked");
    await expect(store.linkIdentity({
      id: "identity-stolen",
      userId: "user-2",
      provider: "google",
      providerSubject: "google-subject",
      now: NOW,
      expectedAuthRevision: 1,
      audit: audit("user-2", "audit-stolen"),
    })).resolves.toBe("linked_elsewhere");
    await expect(store.linkIdentity({
      id: "identity-replacement",
      userId: "user-1",
      provider: "google",
      providerSubject: "different-google-subject",
      now: NOW,
      expectedAuthRevision: 1,
      audit: audit("user-1", "audit-replacement"),
    })).resolves.toBe("linked_elsewhere");
    await expect(store.linkIdentity({
      id: "identity-discord",
      userId: "user-1",
      provider: "discord",
      providerSubject: "discord-subject",
      now: NOW,
      expectedAuthRevision: 1,
      audit: audit("user-1", "audit-discord"),
    })).resolves.toBe("linked");

    expect(count(database, "external_identities")).toBe(2);
    expect(count(database, "audit_log")).toBe(2);
    await expect(store.listIdentities("user-1")).resolves.toHaveLength(2);
  });

  it("revokes every existing session with the unlinked OAuth factor", async () => {
    const { database, store } = harness();
    database.prepare(`INSERT INTO external_identities
      (id, user_id, provider, provider_subject, created_at, last_used_at)
      VALUES ('identity-google', 'user-1', 'google', 'google-subject', ?, ?)`).run(NOW, NOW);
    database.prepare("INSERT INTO sessions (token_digest, user_id, auth_revision) VALUES ('old-session', 'user-1', 1)").run();

    await expect(store.unlinkIdentity({
      userId: "user-1",
      provider: "google",
      expectedAuthRevision: 1,
      audit: audit("user-1", "audit-unlink"),
    })).resolves.toBe(true);

    expect(count(database, "external_identities")).toBe(0);
    expect(count(database, "sessions")).toBe(0);
    expect(database.prepare("SELECT auth_revision FROM user_credentials WHERE user_id = 'user-1'").get())
      .toEqual({ auth_revision: 2 });
  });

  it("does not link with a stale OAuth challenge revision", async () => {
    const { database, store } = harness();
    database.prepare("UPDATE user_credentials SET auth_revision = 2 WHERE user_id = 'user-1'").run();

    await expect(store.linkIdentity({
      id: "stale-link",
      userId: "user-1",
      provider: "google",
      providerSubject: "google-subject",
      now: NOW,
      expectedAuthRevision: 1,
      audit: audit("user-1", "audit-stale-link"),
    })).resolves.toBe("invalid");

    expect(count(database, "external_identities")).toBe(0);
    expect(count(database, "audit_log")).toBe(0);
  });
});
