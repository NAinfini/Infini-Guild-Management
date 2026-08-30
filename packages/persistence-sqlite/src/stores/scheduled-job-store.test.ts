import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSchedulerAuditFactory } from "@guild/server/modules/jobs";
import { LIMITS } from "@guild/shared/config/limits";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import {
  SESSION_CLEANUP_CREATED_CANDIDATES_SQL,
  SESSION_CLEANUP_EXPIRES_CANDIDATES_SQL,
  SqliteAnnouncementPublishStore,
  SqliteEventAutoArchiveStore,
  SqliteRaffleAutoDrawStore,
  SqliteSessionCleanupJob,
} from "./scheduled-job-store.js";

const NOW = "2026-08-09T00:00:00.000Z";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
      start_at TEXT NOT NULL, end_at TEXT, archived_at TEXT,
      auto_archive INTEGER NOT NULL, auto_archived INTEGER NOT NULL,
      signup_locked INTEGER NOT NULL DEFAULT 0, winner_count INTEGER,
      created_by TEXT NOT NULL DEFAULT 'admin-1', updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_raffle_due ON events(type, archived_at, end_at, id);
    CREATE INDEX idx_events_auto_archive_end_due
      ON events(auto_archive, auto_archived, archived_at, end_at, id);
    CREATE INDEX idx_events_auto_archive_start_due
      ON events(auto_archive, auto_archived, archived_at, end_at, start_at, id);
    CREATE TABLE event_participants (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT NOT NULL
    );
    CREATE TABLE event_raffle_draws (event_id TEXT PRIMARY KEY);
    CREATE TABLE event_raffle_winners (event_id TEXT NOT NULL);
    CREATE TABLE announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, publish_at TEXT,
      revision_token TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_announcements_schedule ON announcements(status, publish_at, id);
    CREATE TABLE media_links (
      media_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      slot TEXT NOT NULL, audience TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
      actor_label TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_label TEXT,
      action TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token_digest TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_expires ON sessions(expires_at, token_digest);
    CREATE INDEX idx_sessions_created ON sessions(created_at, token_digest);
    CREATE TABLE notification_inbox (
      id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL
    );
    CREATE TABLE oauth_challenges (
      state_digest TEXT PRIMARY KEY, expires_at TEXT NOT NULL,
      consumed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_oauth_challenges_cleanup_expiry ON oauth_challenges(expires_at, state_digest);
    CREATE INDEX idx_oauth_challenges_cleanup_consumed ON oauth_challenges(consumed_at, state_digest)
      WHERE consumed_at IS NOT NULL;
    CREATE TABLE email_verification_challenges (
      token_digest TEXT PRIMARY KEY, expires_at TEXT NOT NULL,
      consumed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_email_verification_cleanup_expiry ON email_verification_challenges(expires_at, token_digest);
    CREATE INDEX idx_email_verification_cleanup_consumed ON email_verification_challenges(consumed_at, token_digest)
      WHERE consumed_at IS NOT NULL;
  `);
  return db;
}

describe("SQLite scheduled job stores", () => {
  it("auto-archives and audits at most 50 eligible events per batch", async () => {
    const db = database();
    try {
      const insert = db.prepare(`INSERT INTO events
        (id, title, type, start_at, end_at, auto_archive, auto_archived, updated_at)
        VALUES (?, ?, 'social', '2026-08-01T00:00:00.000Z', NULL, 1, 0, ?)`);
      for (let index = 0; index < 51; index += 1) insert.run(`event-${index}`, `Event ${index}`, NOW);
      db.prepare(`INSERT INTO events
        (id, title, type, start_at, end_at, auto_archive, auto_archived, updated_at)
        VALUES ('raffle-1', 'Raffle', 'raffle', '2026-08-01T00:00:00.000Z', NULL, 1, 0, ?)`)
        .run(NOW);

      const store = new SqliteEventAutoArchiveStore(new SqliteTestExecutor(db));
      const first = await store.archiveDue({
        now: NOW,
        limit: 50,
        audit: createSchedulerAuditFactory("archive-1", NOW),
      });
      const second = await store.archiveDue({
        now: NOW,
        limit: 50,
        audit: createSchedulerAuditFactory("archive-2", NOW),
      });
      expect(first).toMatchObject({ eventIds: expect.any(Array), hasMore: true });
      expect(first.eventIds).toHaveLength(50);
      await expect(store.inspectBacklog(NOW)).resolves.toEqual({
        status: "known",
        pendingCount: 0,
        countPrecision: "exact",
        oldestPendingAt: null,
      });
      expect(second).toMatchObject({ eventIds: expect.any(Array), hasMore: false });
      expect(second.eventIds).toHaveLength(1);
      expect((db.prepare("SELECT count(*) AS count FROM audit_log").get() as { count: number }).count).toBe(51);
      expect(db.prepare("SELECT DISTINCT actor_label FROM audit_log").all())
        .toEqual([{ actor_label: null }]);
      expect((db.prepare("SELECT auto_archived FROM events WHERE id = 'raffle-1'").get() as { auto_archived: number }).auto_archived)
        .toBe(0);
    } finally {
      db.close();
    }
  });

  it("atomically claims a due announcement once and reports its bounded backlog", async () => {
    const db = database();
    try {
      db.prepare(`INSERT INTO announcements (id, title, status, publish_at, revision_token, updated_at)
        VALUES ('announcement-1', 'Notice', 'scheduled', ?, 'revision-1', ?)`)
        .run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
      db.prepare(`INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience)
        VALUES ('media-1', 'announcement', 'announcement-1', 'body', 'private')`).run();
      db.prepare(`INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience)
        VALUES ('attachment-1', 'announcement', 'announcement-1', 'attachment', 'private')`).run();
      const executor = new SqliteTestExecutor(db);
      const stores = [
        new SqliteAnnouncementPublishStore(executor),
        new SqliteAnnouncementPublishStore(executor),
      ];
      const results = await Promise.all(stores.map((store, index) => store.publishDue({
        now: NOW,
        limit: 50,
        audit: createSchedulerAuditFactory(`announcement-${index}`, NOW),
      })));

      expect(results.reduce((total, result) => total + result.announcements.length, 0)).toBe(1);
      expect((db.prepare("SELECT status FROM announcements WHERE id = 'announcement-1'").get() as { status: string }).status)
        .toBe("published");
      expect((db.prepare("SELECT audience FROM media_links WHERE media_id = 'media-1'").get() as { audience: string }).audience)
        .toBe("public");
      expect((db.prepare("SELECT audience FROM media_links WHERE media_id = 'attachment-1'").get() as { audience: string }).audience)
        .toBe("public");
      expect((db.prepare("SELECT count(*) AS count FROM audit_log WHERE action = 'publish'").get() as { count: number }).count)
        .toBe(1);
      expect(db.prepare("SELECT DISTINCT actor_label FROM audit_log WHERE action = 'publish'").all())
        .toEqual([{ actor_label: null }]);
      await expect(stores[0]!.inspectBacklog(NOW)).resolves.toEqual({
        status: "known",
        pendingCount: 0,
        countPrecision: "exact",
        oldestPendingAt: null,
      });
      await expect(stores[0]!.publishDue({
        now: NOW,
        limit: 50,
        audit: createSchedulerAuditFactory("announcement-repeat", NOW),
      })).resolves.toEqual({ announcements: [], hasMore: false });
    } finally {
      db.close();
    }
  });

  it("rolls back a scheduled announcement claim when its audit is rejected", async () => {
    const db = database();
    try {
      db.prepare(`INSERT INTO announcements (id, title, status, publish_at, revision_token, updated_at)
        VALUES ('announcement-1', 'Notice', 'scheduled', ?, 'revision-1', ?)`)
        .run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
      db.exec(`CREATE TRIGGER reject_announcement_publish_audit
        BEFORE INSERT ON audit_log WHEN NEW.action = 'publish'
        BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;`);
      const store = new SqliteAnnouncementPublishStore(new SqliteTestExecutor(db));
      await expect(store.publishDue({
        now: NOW,
        limit: 50,
        audit: createSchedulerAuditFactory("announcement-failure", NOW),
      })).rejects.toThrow("audit rejected");
      expect((db.prepare("SELECT status FROM announcements WHERE id = 'announcement-1'").get() as { status: string }).status)
        .toBe("scheduled");
    } finally {
      db.close();
    }
  });

  it("selects ended raffle candidates and their participants with a bounded backlog", async () => {
    const db = database();
    try {
      db.prepare(`INSERT INTO events (
        id, title, type, start_at, end_at, auto_archive, auto_archived, winner_count, updated_at
      ) VALUES ('raffle-1', 'Draw', 'raffle', '2026-08-01T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z', 0, 0, 1, ?)`)
        .run(NOW);
      db.prepare(`INSERT INTO event_participants (id, event_id, user_id, joined_at)
        VALUES ('participant-1', 'raffle-1', 'user-1', ?)`)
        .run(NOW);
      const drawRaffle = async () => [];
      const store = new SqliteRaffleAutoDrawStore(new SqliteTestExecutor(db), { drawRaffle });
      await expect(store.listDue(NOW, 25)).resolves.toEqual({
        raffles: [{
          eventId: "raffle-1",
          title: "Draw",
          winnerCount: 1,
          drawnByUserId: "admin-1",
          updatedAt: NOW,
          participantIds: ["user-1"],
        }],
        hasMore: false,
      });
      await expect(store.inspectBacklog(NOW)).resolves.toEqual({
        status: "known",
        pendingCount: 1,
        countPrecision: "exact",
        oldestPendingAt: "2026-08-08T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  it("rejects corrupt raffles above the per-event participant bound without loading the full set", async () => {
    const db = database();
    try {
      db.prepare(`INSERT INTO events (
        id, title, type, start_at, end_at, auto_archive, auto_archived, winner_count, updated_at
      ) VALUES ('raffle-overflow', 'Overflow', 'raffle', '2026-08-01T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z', 0, 0, 1, ?)`)
        .run(NOW);
      db.exec(`WITH RECURSIVE sequence(value) AS (
          SELECT 1 UNION ALL SELECT value + 1 FROM sequence
          WHERE value < ${LIMITS.content.eventParticipantsPerEvent.max + 1}
        )
        INSERT INTO event_participants (id, event_id, user_id, joined_at)
        SELECT printf('participant-%04d', value), 'raffle-overflow', printf('user-%04d', value), '${NOW}'
        FROM sequence;`);
      const store = new SqliteRaffleAutoDrawStore(new SqliteTestExecutor(db), { drawRaffle: async () => [] });

      await expect(store.listDue(NOW, 25)).rejects.toThrow(/exceeds the participant limit/i);
    } finally {
      db.close();
    }
  });

  it("deletes expired sessions in bounded batches and reports remaining work", async () => {
    const db = database();
    try {
      const insert = db.prepare("INSERT INTO sessions (token_digest, expires_at, created_at) VALUES (?, ?, ?)");
      for (let index = 0; index < 501; index += 1) {
        insert.run(`expired-${index}`, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
      }
      insert.run("active", "2026-09-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
      const executor = new SqliteTestExecutor(db);
      const job = new SqliteSessionCleanupJob(executor);
      expect(await job.run({
        expiresBefore: NOW,
        createdBefore: "2026-05-11T00:00:00.000Z",
        limit: 500,
      })).toEqual({ processed: 500, hasMore: true });
      expect(executor.statements).toHaveLength(0);
      expect(executor.batches.map((batch) => batch.length)).toEqual([7, 4]);
      await expect(job.inspectBacklog({
        expiresBefore: NOW,
        createdBefore: "2026-05-11T00:00:00.000Z",
      })).resolves.toEqual({
        status: "known",
        pendingCount: 1,
        countPrecision: "exact",
        oldestPendingAt: "2026-08-01T00:00:00.000Z",
      });
      expect(await job.run({
        expiresBefore: NOW,
        createdBefore: "2026-05-11T00:00:00.000Z",
        limit: 500,
      })).toEqual({ processed: 1, hasMore: false });
      expect((db.prepare("SELECT count(*) AS count FROM sessions").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("cleans notifications older than three days while retaining the cutoff boundary", async () => {
    const db = database();
    try {
      db.prepare("INSERT INTO notification_inbox (id, occurred_at) VALUES (?, ?)")
        .run("notification-old", "2026-08-05T00:00:00.000Z");
      db.prepare("INSERT INTO notification_inbox (id, occurred_at) VALUES (?, ?)")
        .run("notification-at-cutoff", "2026-08-06T00:00:00.000Z");
      db.prepare("INSERT INTO oauth_challenges (state_digest, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?)")
        .run("oauth-old", "2026-07-01T00:00:00.000Z", null, "2026-07-01T00:00:00.000Z");
      db.prepare("INSERT INTO email_verification_challenges (token_digest, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?)")
        .run("email-old", "2026-07-01T00:00:00.000Z", null, "2026-07-01T00:00:00.000Z");

      const job = new SqliteSessionCleanupJob(new SqliteTestExecutor(db));
      await expect(job.run({
        expiresBefore: NOW,
        createdBefore: "2026-05-11T00:00:00.000Z",
        limit: 500,
      })).resolves.toEqual({ processed: 3, hasMore: false });

      expect(db.prepare("SELECT id FROM notification_inbox").all()).toEqual([{ id: "notification-at-cutoff" }]);
      expect(db.prepare("SELECT state_digest FROM oauth_challenges").all()).toEqual([]);
      expect(db.prepare("SELECT token_digest FROM email_verification_challenges").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("honors small total limits across all maintenance record types", async () => {
    const db = database();
    try {
      db.prepare("INSERT INTO sessions (token_digest, expires_at, created_at) VALUES (?, ?, ?)")
        .run("session-old", "2026-01-05T00:00:00.000Z", "2026-01-05T00:00:00.000Z");
      db.prepare("INSERT INTO notification_inbox (id, occurred_at) VALUES (?, ?)")
        .run("notification-old", "2026-01-01T00:00:00.000Z");
      db.prepare("INSERT INTO oauth_challenges (state_digest, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?)")
        .run("oauth-old", "2026-01-02T00:00:00.000Z", null, "2026-01-02T00:00:00.000Z");
      db.prepare("INSERT INTO email_verification_challenges (token_digest, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?)")
        .run("email-old", "2026-01-03T00:00:00.000Z", null, "2026-01-03T00:00:00.000Z");

      const job = new SqliteSessionCleanupJob(new SqliteTestExecutor(db));
      await expect(job.run({
        expiresBefore: NOW,
        createdBefore: "2026-05-11T00:00:00.000Z",
        limit: 2,
      })).resolves.toEqual({ processed: 2, hasMore: true });
      expect(db.prepare("SELECT id FROM notification_inbox").all()).toEqual([]);
      expect(db.prepare("SELECT state_digest FROM oauth_challenges").all()).toEqual([]);

      await expect(job.run({
        expiresBefore: NOW,
        createdBefore: "2026-05-11T00:00:00.000Z",
        limit: 2,
      })).resolves.toEqual({ processed: 2, hasMore: false });
    } finally {
      db.close();
    }
  });

  it("reports a truncated union of disjoint session candidate sets as at-least", async () => {
    const db = database();
    try {
      const insert = db.prepare("INSERT INTO sessions (token_digest, expires_at, created_at) VALUES (?, ?, ?)");
      for (let index = 0; index < 600; index += 1) {
        insert.run(`expires-${index}`, "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z");
        insert.run(`created-${index}`, "2026-09-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");
      }

      const job = new SqliteSessionCleanupJob(new SqliteTestExecutor(db));
      await expect(job.inspectBacklog({
        expiresBefore: NOW,
        createdBefore: "2026-06-15T00:00:00.000Z",
      })).resolves.toEqual({
        status: "known",
        pendingCount: 1_001,
        countPrecision: "at-least",
        oldestPendingAt: "2026-06-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  it("uses covering indexes for both bounded session candidate sets", () => {
    const db = database();
    try {
      const expiresPlan = db.prepare(`EXPLAIN QUERY PLAN ${SESSION_CLEANUP_EXPIRES_CANDIDATES_SQL}`)
        .all(NOW, 500) as Array<Record<string, unknown>>;
      const createdPlan = db.prepare(`EXPLAIN QUERY PLAN ${SESSION_CLEANUP_CREATED_CANDIDATES_SQL}`)
        .all("2026-05-11T00:00:00.000Z", 500) as Array<Record<string, unknown>>;
      expect(expiresPlan.map(({ detail }) => String(detail)).join(" ")).toContain("idx_sessions_expires");
      expect(createdPlan.map(({ detail }) => String(detail)).join(" ")).toContain("idx_sessions_created");
      expect([...expiresPlan, ...createdPlan].some(({ detail }) => String(detail).includes("USE TEMP B-TREE")))
        .toBe(false);
    } finally {
      db.close();
    }
  });
});
