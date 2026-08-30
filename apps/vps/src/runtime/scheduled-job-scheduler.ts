import type {
  ScheduledJobCoordinator,
  ScheduledJobOutcome,
  ScheduledJobSchedule,
} from "@guild/server";

const QUARTER_HOUR_MS = 15 * 60_000;
const HALF_HOUR_MS = 30 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const SCHEDULE_TIMING = Object.freeze({
  "quarter-hourly": { intervalMs: QUARTER_HOUR_MS, offsetMs: 0 },
  "half-hourly": { intervalMs: HALF_HOUR_MS, offsetMs: 7 * 60_000 },
  "hourly-media": { intervalMs: HOUR_MS, offsetMs: 12 * 60_000 },
  "hourly-cleanup": { intervalMs: HOUR_MS, offsetMs: 42 * 60_000 },
  daily: { intervalMs: DAY_MS, offsetMs: 27 * 60_000 },
} satisfies Record<ScheduledJobSchedule, Readonly<{ intervalMs: number; offsetMs: number }>>);

const SCHEDULES = Object.freeze(Object.keys(SCHEDULE_TIMING) as ScheduledJobSchedule[]);

export type VpsScheduledJobSchedulerOptions = Readonly<{
  now?: () => number;
  onError?: (error: unknown, schedule: ScheduledJobSchedule) => void | Promise<void>;
  onOutcome?: (outcome: ScheduledJobOutcome, schedule: ScheduledJobSchedule) => void | Promise<void>;
}>;

function nextBoundaryDelay(schedule: ScheduledJobSchedule, now: number): number {
  if (!Number.isFinite(now) || now < 0) throw new TypeError("Scheduler clock returned an invalid timestamp");
  const { intervalMs, offsetMs } = SCHEDULE_TIMING[schedule];
  const remainder = ((now - offsetMs) % intervalMs + intervalMs) % intervalMs;
  return remainder === 0 ? intervalMs : intervalMs - remainder;
}

export class VpsScheduledJobScheduler {
  private readonly timers = new Map<ScheduledJobSchedule, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Promise<void>>();
  private readonly now: () => number;
  private readonly onError: (error: unknown, schedule: ScheduledJobSchedule) => void | Promise<void>;
  private readonly onOutcome: (
    outcome: ScheduledJobOutcome,
    schedule: ScheduledJobSchedule,
  ) => void | Promise<void>;
  private stopped = true;

  constructor(
    private readonly coordinator: Pick<ScheduledJobCoordinator, "runSchedule">,
    options: VpsScheduledJobSchedulerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onError = options.onError
      ?? ((error, schedule) => console.error(`Scheduled ${schedule} jobs failed`, error));
    this.onOutcome = options.onOutcome ?? ((outcome, schedule) => {
      const details = { schedule, ...outcome };
      if (outcome.status === "failed") console.error("VPS scheduled job failed", details);
      else if (outcome.backlog.status === "unknown") console.warn("VPS scheduled job backlog is unknown", details);
      else console.info("VPS scheduled job completed", details);
    });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    for (const schedule of SCHEDULES) this.schedule(schedule);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all([...this.running]);
  }

  private schedule(schedule: ScheduledJobSchedule): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(schedule);
      this.run(schedule);
    }, nextBoundaryDelay(schedule, this.now()));
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(schedule, timer);
  }

  private run(schedule: ScheduledJobSchedule): void {
    const operation = this.coordinator.runSchedule(schedule)
      .then(async (outcomes) => {
        for (const outcome of outcomes) await this.reportOutcome(outcome, schedule);
      })
      .catch((error: unknown) => this.report(error, schedule))
      .finally(() => {
        this.running.delete(operation);
        this.schedule(schedule);
      });
    this.running.add(operation);
  }

  private async reportOutcome(outcome: ScheduledJobOutcome, schedule: ScheduledJobSchedule): Promise<void> {
    try {
      await this.onOutcome(outcome, schedule);
    } catch (error) {
      console.error("Scheduled job outcome reporter failed", error, { schedule, outcome });
    }
  }

  private async report(error: unknown, schedule: ScheduledJobSchedule): Promise<void> {
    try {
      await this.onError(error, schedule);
    } catch (reportError) {
      console.error("Scheduled job error reporter failed", reportError, { schedule, originalError: error });
    }
  }
}
