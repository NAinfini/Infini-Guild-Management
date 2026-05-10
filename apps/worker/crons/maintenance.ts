import type { Bindings } from "../index";
import { logger } from "../utils/logger";
import { writeErrorLog } from "../services/ErrorLogService";
import { runAnnouncementPublishCron } from "./announcement-publish";
import { runAuditArchiveCron } from "./audit-archive";
import { runErrorLogCleanupCron } from "./error-log-cleanup";
import { runEventAutoArchiveCron } from "./event-auto-archive";
import { runEventInstanceGenerationCron } from "./event-instance-gen";
import { runMediaOrphanCleanupCron } from "./media-orphan-cleanup";
import { runSessionCleanupCron } from "./session-cleanup";

export type MaintenanceJob = {
  name: string;
  run: (env: Bindings) => Promise<void>;
};

export const DAILY_MAINTENANCE_JOBS: readonly MaintenanceJob[] = [
  { name: "audit-archive", run: runAuditArchiveCron },
  { name: "media-orphan-cleanup", run: runMediaOrphanCleanupCron },
  { name: "error-log-cleanup", run: runErrorLogCleanupCron },
];

export const QUARTER_HOURLY_MAINTENANCE_JOBS: readonly MaintenanceJob[] = [
  { name: "event-instance-gen", run: runEventInstanceGenerationCron },
  { name: "event-auto-archive", run: runEventAutoArchiveCron },
  { name: "session-cleanup", run: runSessionCleanupCron },
  { name: "announcement-publish", run: runAnnouncementPublishCron },
];

async function runMaintenanceJobs(env: Bindings, jobs: readonly MaintenanceJob[], cron: string): Promise<void> {
  const failures: string[] = [];

  await Promise.all(
    jobs.map(async (job) => {
      const start = Date.now();
      try {
        await job.run(env);
      } catch (error) {
        failures.push(job.name);
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error("Cron job failed", {
          source: "cron",
          job: job.name,
          cron,
          elapsed_ms: Date.now() - start,
          error: message,
          stack,
        });
        await writeErrorLog(env.DB, {
          source: "cron",
          message: `[${job.name}] ${message}`,
          stack,
          context: { job: job.name, cron, elapsed_ms: Date.now() - start },
        });
      }
    }),
  );

  if (failures.length > 0) {
    throw new Error(`Cron group failed: ${failures.join(", ")}`);
  }
}

export async function runDailyMaintenanceCron(env: Bindings, cron: string): Promise<void> {
  await runMaintenanceJobs(env, DAILY_MAINTENANCE_JOBS, cron);
}

export async function runQuarterHourlyMaintenanceCron(env: Bindings, cron: string): Promise<void> {
  await runMaintenanceJobs(env, QUARTER_HOURLY_MAINTENANCE_JOBS, cron);
}
