import {
  SCHEDULED_JOB_NAMES,
  type ScheduledJobLeaseStore,
  type ScheduledJobName,
} from "@guild/server/modules/jobs";
import type { SqlExecutor } from "@guild/kernel";
import { returnedRowCount } from "./sql-result.js";

const jobNames = new Set<string>(SCHEDULED_JOB_NAMES);

export const SCHEDULED_JOB_LEASE_TABLE_SQL = `CREATE TABLE scheduled_job_leases (
  job_name TEXT PRIMARY KEY CHECK (job_name IN (
    'recurrence-materialization', 'announcement-publish', 'raffle-auto-draw', 'event-auto-archive',
    'media-gc', 'audit-archive', 'session-cleanup', 'system-test-cleanup'
  )),
  lease_token TEXT NOT NULL CHECK (length(lease_token) BETWEEN 16 AND 128),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cursor_value TEXT,
  CHECK (acquired_at < expires_at)
) WITHOUT ROWID`;

function assertJobName(jobName: ScheduledJobName): void {
  if (!jobNames.has(jobName)) throw new TypeError("Unknown scheduled job name");
}

function assertIso(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${field} must be an ISO timestamp`);
  }
}

function assertLeaseToken(leaseToken: string): void {
  if (leaseToken.length < 16 || leaseToken.length > 128) {
    throw new TypeError("Scheduled job lease token must be between 16 and 128 characters");
  }
}

export class SqliteScheduledJobLeaseStore implements ScheduledJobLeaseStore {
  constructor(private readonly sql: SqlExecutor) {}

  async tryAcquire(input: Readonly<{
    jobName: ScheduledJobName;
    leaseToken: string;
    acquiredAt: string;
    expiresAt: string;
  }>): Promise<boolean> {
    assertJobName(input.jobName);
    assertLeaseToken(input.leaseToken);
    assertIso(input.acquiredAt, "Lease acquisition time");
    assertIso(input.expiresAt, "Lease expiry time");
    if (input.acquiredAt >= input.expiresAt) throw new TypeError("Scheduled job lease must expire after acquisition");

    const result = await this.sql.execute({
      method: "get",
      sql: `INSERT INTO scheduled_job_leases (job_name, lease_token, acquired_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(job_name) DO UPDATE SET
          lease_token = excluded.lease_token,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at
        WHERE scheduled_job_leases.expires_at <= excluded.acquired_at
        RETURNING lease_token`,
      params: [input.jobName, input.leaseToken, input.acquiredAt, input.expiresAt],
    });
    const row = result.rows;
    return Array.isArray(row) && typeof row[0] === "string" && row[0] === input.leaseToken;
  }

  async renew(input: Readonly<{
    jobName: ScheduledJobName;
    leaseToken: string;
    renewedAt: string;
    expiresAt: string;
  }>): Promise<boolean> {
    assertJobName(input.jobName);
    assertLeaseToken(input.leaseToken);
    assertIso(input.renewedAt, "Lease renewal time");
    assertIso(input.expiresAt, "Lease expiry time");
    if (input.renewedAt >= input.expiresAt) throw new TypeError("Scheduled job lease must expire after renewal");
    const result = await this.sql.execute({
      method: "get",
      sql: `UPDATE scheduled_job_leases SET expires_at = ?
        WHERE job_name = ? AND lease_token = ? AND expires_at > ?
        RETURNING 1 AS affected`,
      params: [input.expiresAt, input.jobName, input.leaseToken, input.renewedAt],
    });
    return returnedRowCount(result) === 1;
  }

  async readCursor(jobName: ScheduledJobName, leaseToken: string): Promise<string | null | undefined> {
    assertJobName(jobName);
    assertLeaseToken(leaseToken);
    const result = await this.sql.execute({
      method: "get",
      sql: "SELECT cursor_value FROM scheduled_job_leases WHERE job_name = ? AND lease_token = ?",
      params: [jobName, leaseToken],
    });
    if (result.rows === undefined) return undefined;
    if (!Array.isArray(result.rows) || Array.isArray(result.rows[0]) || result.rows.length !== 1) {
      throw new TypeError("SQLite returned an invalid scheduled-job cursor row");
    }
    const cursor = result.rows[0];
    if (cursor !== null && typeof cursor !== "string") {
      throw new TypeError("SQLite returned an invalid scheduled-job cursor");
    }
    return cursor;
  }

  async writeCursor(
    jobName: ScheduledJobName,
    leaseToken: string,
    cursor: string | null,
    writtenAt: string,
  ): Promise<boolean> {
    assertJobName(jobName);
    assertLeaseToken(leaseToken);
    if (cursor !== null && !cursor) throw new TypeError("Scheduled job cursor cannot be empty");
    assertIso(writtenAt, "Cursor write time");
    const result = await this.sql.execute({
      method: "get",
      sql: `UPDATE scheduled_job_leases SET cursor_value = ?
        WHERE job_name = ? AND lease_token = ? AND expires_at > ?
        RETURNING 1 AS affected`,
      params: [cursor, jobName, leaseToken, writtenAt],
    });
    return returnedRowCount(result) === 1;
  }

  async release(jobName: ScheduledJobName, leaseToken: string): Promise<void> {
    assertJobName(jobName);
    assertLeaseToken(leaseToken);
    await this.sql.execute({
      method: "run",
      sql: `UPDATE scheduled_job_leases
        SET lease_token = 'released-lease-token',
            acquired_at = '0000-01-01T00:00:00.000Z',
            expires_at = '0000-01-01T00:00:00.001Z'
        WHERE job_name = ? AND lease_token = ?`,
      params: [jobName, leaseToken],
    });
  }
}
