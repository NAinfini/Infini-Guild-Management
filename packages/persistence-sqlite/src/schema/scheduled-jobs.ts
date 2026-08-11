import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  SCHEDULED_JOB_NAMES,
  type ScheduledJobName,
} from "@guild/server/modules/jobs";

const jobNameIds = [...SCHEDULED_JOB_NAMES] as [ScheduledJobName, ...ScheduledJobName[]];
const jobNameValues = sql.raw(SCHEDULED_JOB_NAMES.map((name) => `'${name}'`).join(", "));

export const scheduledJobLeases = sqliteTable(
  "scheduled_job_leases",
  {
    jobName: text("job_name", { enum: jobNameIds }).primaryKey(),
    leaseToken: text("lease_token").notNull(),
    acquiredAt: text("acquired_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    cursorValue: text("cursor_value"),
  },
  (table) => [
    check("scheduled_job_leases_job_name_valid", sql`${table.jobName} IN (${jobNameValues})`),
    check(
      "scheduled_job_leases_lease_token_valid",
      sql`length(${table.leaseToken}) BETWEEN 16 AND 128`,
    ),
    check("scheduled_job_leases_interval_valid", sql`${table.acquiredAt} < ${table.expiresAt}`),
  ],
);
