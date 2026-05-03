import type { Bindings } from "../index";
import { runAnnouncementExpiryCron, runAnnouncementPublishCron } from "./announcement-publish";
import { runAuditArchiveCron } from "./audit-archive";
import { runEventAutoArchiveCron } from "./event-auto-archive";
import { runEventInstanceGenerationCron } from "./event-instance-gen";
import { runMediaOrphanCleanupCron } from "./media-orphan-cleanup";
import { runSessionCleanupCron } from "./session-cleanup";

export type MaintenanceJob = {
  name: string;
  run: (env: Bindings) => Promise<void>;
};

export const DAILY_MAINTENANCE_JOBS: readonly MaintenanceJob[] = [
  { name: "event-instance-gen", run: runEventInstanceGenerationCron },
  { name: "session-cleanup", run: runSessionCleanupCron },
  { name: "audit-archive", run: runAuditArchiveCron },
  { name: "media-orphan-cleanup", run: runMediaOrphanCleanupCron },
];

export const QUARTER_HOURLY_MAINTENANCE_JOBS: readonly MaintenanceJob[] = [
  { name: "event-auto-archive", run: runEventAutoArchiveCron },
  { name: "announcement-publish", run: runAnnouncementPublishCron },
  { name: "announcement-expiry", run: runAnnouncementExpiryCron },
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
        console.error(JSON.stringify({
          level: "error",
          source: "cron",
          job: job.name,
          cron,
          elapsed_ms: Date.now() - start,
          error: message,
          stack,
          timestamp: new Date().toISOString(),
        }));
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
