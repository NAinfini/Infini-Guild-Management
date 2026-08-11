import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import {
  SCHEDULED_JOB_LEASE_TABLE_SQL,
  SqliteScheduledJobLeaseStore,
} from "./scheduled-job-lease-store.js";

describe("SqliteScheduledJobLeaseStore", () => {
  it("renews by token CAS, preserves the keyset cursor, and releases by token", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(SCHEDULED_JOB_LEASE_TABLE_SQL);
      const store = new SqliteScheduledJobLeaseStore(new SqliteTestExecutor(database));
      const first = {
        jobName: "media-gc" as const,
        leaseToken: "lease-token-first",
        acquiredAt: "2026-08-09T00:00:00.000Z",
        expiresAt: "2026-08-09T00:10:00.000Z",
      };
      expect(await store.tryAcquire(first)).toBe(true);
      expect(await store.readCursor(first.jobName, first.leaseToken)).toBeNull();
      expect(await store.writeCursor(
        first.jobName,
        "lease-token-wrong",
        "template-025",
        "2026-08-09T00:01:00.000Z",
      )).toBe(false);
      expect(await store.writeCursor(
        first.jobName,
        first.leaseToken,
        "template-025",
        "2026-08-09T00:01:00.000Z",
      )).toBe(true);
      expect(await store.tryAcquire({
        ...first,
        leaseToken: "lease-token-second",
        acquiredAt: "2026-08-09T00:05:00.000Z",
        expiresAt: "2026-08-09T00:15:00.000Z",
      })).toBe(false);
      expect(await store.renew({
        jobName: first.jobName,
        leaseToken: first.leaseToken,
        renewedAt: "2026-08-09T00:05:00.000Z",
        expiresAt: "2026-08-09T00:15:00.000Z",
      })).toBe(true);
      expect(await store.tryAcquire({
        ...first,
        leaseToken: "lease-token-second",
        acquiredAt: first.expiresAt,
        expiresAt: "2026-08-09T00:20:00.000Z",
      })).toBe(false);
      expect(await store.tryAcquire({
        ...first,
        leaseToken: "lease-token-second",
        acquiredAt: "2026-08-09T00:15:00.000Z",
        expiresAt: "2026-08-09T00:25:00.000Z",
      })).toBe(true);
      expect(await store.readCursor(first.jobName, "lease-token-second")).toBe("template-025");
      expect(await store.renew({
        jobName: first.jobName,
        leaseToken: first.leaseToken,
        renewedAt: "2026-08-09T00:15:00.000Z",
        expiresAt: "2026-08-09T00:25:00.000Z",
      })).toBe(false);

      await store.release(first.jobName, first.leaseToken);
      expect(await store.tryAcquire({
        ...first,
        leaseToken: "lease-token-third",
        acquiredAt: "2026-08-09T00:16:00.000Z",
        expiresAt: "2026-08-09T00:26:00.000Z",
      })).toBe(false);
      await store.release(first.jobName, "lease-token-second");
      expect(await store.tryAcquire({
        ...first,
        leaseToken: "lease-token-third",
        acquiredAt: "2026-08-09T00:16:00.000Z",
        expiresAt: "2026-08-09T00:26:00.000Z",
      })).toBe(true);
      expect(await store.readCursor(first.jobName, "lease-token-third")).toBe("template-025");
    } finally {
      database.close();
    }
  });
});
