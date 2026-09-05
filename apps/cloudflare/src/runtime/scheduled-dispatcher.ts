import type {
  ScheduledJobCoordinator,
  ScheduledJobOutcome,
  ScheduledJobSchedule,
} from "@guild/server";

export const CLOUDFLARE_SCHEDULED_CRONS = Object.freeze({
  daily: "27 0 * * *",
  "quarter-hourly": "*/15 * * * *",
  "half-hourly": "7,37 * * * *",
  "hourly-media": "12 * * * *",
  "hourly-cleanup": "42 * * * *",
} satisfies Record<ScheduledJobSchedule, string>);

export type CloudflareScheduledEvent = Readonly<{ cron: string }>;
export type CloudflareWaitUntil = Readonly<{ waitUntil(promise: Promise<unknown>): void }>;

function recordOutcome(schedule: ScheduledJobSchedule, outcome: ScheduledJobOutcome): void {
  const details = { schedule, ...outcome };
  if (outcome.status === "failed") {
    console.error("Cloudflare scheduled job failed", details);
  } else if (outcome.status === "completed" && outcome.warning) {
    console.warn("Cloudflare scheduled job completed with warning", details);
  } else if (outcome.backlog.status === "unknown") {
    console.warn("Cloudflare scheduled job backlog is unknown", details);
  } else {
    console.info("Cloudflare scheduled job completed", details);
  }
}

export function dispatchCloudflareScheduledJobs(
  event: CloudflareScheduledEvent,
  context: CloudflareWaitUntil,
  coordinator: Pick<ScheduledJobCoordinator, "runSchedule">,
): boolean {
  const schedule = scheduledJobScheduleForCron(event.cron);
  if (!schedule) return false;
  context.waitUntil(coordinator.runSchedule(schedule).then((outcomes) => {
    for (const outcome of outcomes) recordOutcome(schedule, outcome);
  }));
  return true;
}

function scheduledJobScheduleForCron(cron: string): ScheduledJobSchedule | null {
  for (const [schedule, configuredCron] of Object.entries(CLOUDFLARE_SCHEDULED_CRONS)) {
    if (cron === configuredCron) return schedule as ScheduledJobSchedule;
  }
  return null;
}
