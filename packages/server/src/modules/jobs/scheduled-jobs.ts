import type { JsonObject } from "@guild/shared";
import type { AuditAction, AuditEntityType } from "@guild/shared/constants/audit";
import { createAuthorizationContext, createRequestContext, type ScheduledJobBacklog } from "@guild/kernel";
import {
  createAuditMutationForActor,
  type AuditMutation,
} from "../audit/public.js";

const JOB_LEASE_MS = 10 * 60_000;
const JOB_LEASE_RENEWAL_MS = Math.floor(JOB_LEASE_MS / 3);
const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60_000;
const MAX_BATCHES_PER_RUN = 8;
const MAX_RUN_DURATION_MS = 25_000;

export const SCHEDULER_SYSTEM_ACTOR_ID = "system:scheduler";

export const SCHEDULED_JOB_LIMITS = Object.freeze({
  recurrenceMaterialization: Object.freeze({ templates: 25, occurrencesPerTemplate: 10 }),
  announcementPublish: 50,
  raffleAutoDraw: 25,
  eventAutoArchive: 50,
  mediaGarbageCollection: 50,
  auditArchive: 100,
  sessionCleanup: 500,
  systemTestCleanup: 25,
} as const);

export const SCHEDULED_JOB_NAMES = [
  "recurrence-materialization",
  "announcement-publish",
  "raffle-auto-draw",
  "event-auto-archive",
  "media-gc",
  "audit-archive",
  "session-cleanup",
  "system-test-cleanup",
] as const;

export type ScheduledJobName = (typeof SCHEDULED_JOB_NAMES)[number];
export type ScheduledJobSchedule = "quarter-hourly" | "daily";

export const SCHEDULED_JOB_GROUPS = Object.freeze({
  "quarter-hourly": [
    "recurrence-materialization",
    "announcement-publish",
    "raffle-auto-draw",
    "session-cleanup",
    "system-test-cleanup",
    "event-auto-archive",
    "media-gc",
  ] as const,
  daily: ["audit-archive"] as const,
}) satisfies Readonly<Record<ScheduledJobSchedule, readonly ScheduledJobName[]>>;

export type SchedulerSystemActor = Readonly<{
  kind: "system";
  id: typeof SCHEDULER_SYSTEM_ACTOR_ID;
}>;

export type SchedulerAuditFactory = (input: Readonly<{
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  summary?: string | null;
  details?: JsonObject | null;
}>) => AuditMutation;

export type ScheduledJobBatchResult = Readonly<{
  processed: number;
  hasMore: boolean;
}>;

export interface RecurrenceMaterializationJob {
  run(input: Readonly<{
    now: string;
    afterTemplateId: string | null;
    maxTemplates: number;
    maxOccurrencesPerTemplate: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult & Readonly<{ nextTemplateCursor: string | null }>>;
  inspectBacklog(input: Readonly<{ now: string }>): Promise<ScheduledJobBacklog>;
}

export interface EventAutoArchiveJob {
  run(input: Readonly<{
    now: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{ now: string }>): Promise<ScheduledJobBacklog>;
}

export interface AnnouncementPublishJob {
  run(input: Readonly<{
    now: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{ now: string }>): Promise<ScheduledJobBacklog>;
}

export interface RaffleAutoDrawJob {
  run(input: Readonly<{
    now: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{ now: string }>): Promise<ScheduledJobBacklog>;
}

export interface MediaGarbageCollectionJob {
  run(input: Readonly<{
    before: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{ before: string }>): Promise<ScheduledJobBacklog>;
}

export interface AuditArchiveJob {
  run(input: Readonly<{
    before: string;
    now: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{ before: string }>): Promise<ScheduledJobBacklog>;
}

export interface SessionCleanupJob {
  run(input: Readonly<{
    expiresBefore: string;
    createdBefore: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{
    expiresBefore: string;
    createdBefore: string;
  }>): Promise<ScheduledJobBacklog>;
}

export interface SystemTestCleanupJob {
  run(input: Readonly<{
    before: string;
    limit: number;
  }>): Promise<ScheduledJobBatchResult>;
  inspectBacklog(input: Readonly<{ before: string }>): Promise<ScheduledJobBacklog>;
}

export interface ScheduledJobLeaseStore {
  tryAcquire(input: Readonly<{
    jobName: ScheduledJobName;
    leaseToken: string;
    acquiredAt: string;
    expiresAt: string;
  }>): Promise<boolean>;
  renew(input: Readonly<{
    jobName: ScheduledJobName;
    leaseToken: string;
    renewedAt: string;
    expiresAt: string;
  }>): Promise<boolean>;
  readCursor(jobName: ScheduledJobName, leaseToken: string): Promise<string | null | undefined>;
  writeCursor(
    jobName: ScheduledJobName,
    leaseToken: string,
    cursor: string | null,
    writtenAt: string,
  ): Promise<boolean>;
  release(jobName: ScheduledJobName, leaseToken: string): Promise<void>;
}

export type ScheduledJobCoordinatorDependencies = Readonly<{
  leases: ScheduledJobLeaseStore;
  recurrenceMaterialization: RecurrenceMaterializationJob;
  announcementPublish: AnnouncementPublishJob;
  raffleAutoDraw: RaffleAutoDrawJob;
  eventAutoArchive: EventAutoArchiveJob;
  mediaGarbageCollection: MediaGarbageCollectionJob;
  auditArchive: AuditArchiveJob;
  sessionCleanup: SessionCleanupJob;
  systemTestCleanup: SystemTestCleanupJob;
  now?: () => Date;
  monotonicNow?: () => number;
  createLeaseToken?: () => string;
}>;

type CompletedScheduledJobOutcome = Readonly<{
  name: ScheduledJobName;
  status: "completed";
  processed: number;
  hasMore: boolean;
  batches: number;
  backlog: ScheduledJobBacklog;
}>;

type LeaseHeldScheduledJobOutcome = Readonly<{
  name: ScheduledJobName;
  status: "lease-held";
  processed: 0;
  hasMore: true;
  batches: 0;
  backlog: ScheduledJobBacklog;
}>;

type FailedScheduledJobOutcome = Readonly<{
  name: ScheduledJobName;
  status: "failed";
  processed: null;
  hasMore: null;
  batches: null;
  backlog: ScheduledJobBacklog;
  error: string;
}>;

export type ScheduledJobOutcome =
  | CompletedScheduledJobOutcome
  | LeaseHeldScheduledJobOutcome
  | FailedScheduledJobOutcome;

export function createSchedulerSystemActor(): SchedulerSystemActor {
  return Object.freeze({ kind: "system", id: SCHEDULER_SYSTEM_ACTOR_ID });
}

export function createSchedulerAuditFactory(runId: string, now: string): SchedulerAuditFactory {
  const actor = createSchedulerSystemActor();
  const context = createRequestContext({
    requestId: `scheduled:${runId}`,
    authorization: createAuthorizationContext(null),
    now,
  });
  return (input) => createAuditMutationForActor(context, actor.id, input);
}

function auditArchiveCutoff(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString();
}

function assertBatchResult(result: ScheduledJobBatchResult, maximum: number, name: ScheduledJobName): void {
  if (!Number.isSafeInteger(result.processed) || result.processed < 0 || result.processed > maximum) {
    throw new RangeError(`${name} processed outside its configured batch limit`);
  }
  if (typeof result.hasMore !== "boolean") throw new TypeError(`${name} must report whether work remains`);
}

function unknownBacklog(
  reason: Extract<ScheduledJobBacklog, { status: "unknown" }>["reason"],
  detail?: string,
): ScheduledJobBacklog {
  return {
    status: "unknown",
    pendingCount: null,
    countPrecision: "unknown",
    oldestPendingAt: null,
    reason,
    ...(detail ? { detail: detail.slice(0, 500) } : {}),
  };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function assertBacklog(backlog: ScheduledJobBacklog, name: ScheduledJobName): void {
  if (backlog.status === "unknown") return;
  if (!Number.isSafeInteger(backlog.pendingCount) || backlog.pendingCount < 0) {
    throw new TypeError(`${name} returned an invalid backlog count`);
  }
  if (backlog.oldestPendingAt !== null && !Number.isFinite(Date.parse(backlog.oldestPendingAt))) {
    throw new TypeError(`${name} returned an invalid oldest pending timestamp`);
  }
  if ((backlog.pendingCount === 0) !== (backlog.oldestPendingAt === null)) {
    throw new TypeError(`${name} returned an inconsistent backlog observation`);
  }
}

export class ScheduledJobCoordinator {
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly createLeaseToken: () => string;

  constructor(private readonly dependencies: ScheduledJobCoordinatorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.createLeaseToken = dependencies.createLeaseToken ?? (() => crypto.randomUUID());
  }

  async run(name: ScheduledJobName): Promise<ScheduledJobOutcome> {
    const nowDate = this.now();
    if (!Number.isFinite(nowDate.getTime())) throw new TypeError("Scheduled job clock returned an invalid date");
    const now = nowDate.toISOString();
    const leaseToken = this.createLeaseToken();
    if (!leaseToken.trim()) throw new TypeError("Scheduled job lease token is required");
    const acquired = await this.dependencies.leases.tryAcquire({
      jobName: name,
      leaseToken,
      acquiredAt: now,
      expiresAt: new Date(nowDate.getTime() + JOB_LEASE_MS).toISOString(),
    });
    if (!acquired) {
      return {
        name,
        status: "lease-held",
        processed: 0,
        hasMore: true,
        batches: 0,
        backlog: unknownBacklog("lease-held"),
      };
    }

    const heartbeat = this.maintainLease(name, leaseToken);
    let result: (ScheduledJobBatchResult & Readonly<{
      batches: number;
      backlog: ScheduledJobBacklog;
    }>) | undefined;
    let failure: unknown;
    try {
      const afterTemplateId = name === "recurrence-materialization"
        ? await this.dependencies.leases.readCursor(name, leaseToken)
        : null;
      if (name === "recurrence-materialization" && afterTemplateId === undefined) {
        throw new Error("Recurrence materialization lease was lost before reading its cursor");
      }
      const drained = await this.drainLeased(
        name,
        leaseToken,
        nowDate,
        createSchedulerAuditFactory(leaseToken, now),
        afterTemplateId ?? null,
        heartbeat,
      );
      let backlog: ScheduledJobBacklog;
      try {
        backlog = await this.inspectBacklog(name, nowDate);
        assertBacklog(backlog, name);
      } catch (error) {
        backlog = unknownBacklog("inspection-failed", errorMessage(error));
      }
      result = { ...drained, backlog };
    } catch (error) {
      failure = error;
    }
    try {
      await heartbeat.stop();
    } catch (error) {
      failure = failure === undefined
        ? error
        : new AggregateError([failure, error], `${name} failed while renewing its lease`);
    }
    try {
      await this.dependencies.leases.release(name, leaseToken);
    } catch (error) {
      failure = failure === undefined
        ? error
        : new AggregateError([failure, error], `${name} failed and its lease could not be released`);
    }
    if (failure !== undefined) throw failure;
    if (!result) throw new Error(`${name} completed without a result`);
    return {
      name,
      status: "completed",
      processed: result.processed,
      hasMore: result.hasMore,
      batches: result.batches,
      backlog: result.backlog,
    };
  }

  private maintainLease(jobName: ScheduledJobName, leaseToken: string): Readonly<{
    renewNow(): Promise<void>;
    stop(): Promise<void>;
  }> {
    let stopped = false;
    let failed = false;
    let failure: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    const renewNow = (): Promise<void> => {
      pending = pending.then(async () => {
        const renewedAtDate = this.now();
        if (!Number.isFinite(renewedAtDate.getTime())) {
          throw new TypeError("Scheduled job clock returned an invalid date");
        }
        const renewedAt = renewedAtDate.toISOString();
        if (!await this.dependencies.leases.renew({
          jobName,
          leaseToken,
          renewedAt,
          expiresAt: new Date(renewedAtDate.getTime() + JOB_LEASE_MS).toISOString(),
        })) {
          throw new Error(`${jobName} lease was lost during renewal`);
        }
      }).catch((error: unknown) => {
        failed = true;
        failure = error;
        throw error;
      });
      return pending;
    };
    const schedule = () => {
      timer = setTimeout(() => {
        void renewNow().then(() => {
          if (!stopped) schedule();
        }).catch(() => undefined);
      }, JOB_LEASE_RENEWAL_MS);
      (timer as { unref?: () => void }).unref?.();
    };
    schedule();
    return {
      renewNow,
      stop: async () => {
        stopped = true;
        if (timer !== undefined) clearTimeout(timer);
        await pending;
        if (failed) throw failure;
      },
    };
  }

  private async drainLeased(
    name: ScheduledJobName,
    leaseToken: string,
    nowDate: Date,
    audit: SchedulerAuditFactory,
    initialCursor: string | null,
    heartbeat: Readonly<{ renewNow(): Promise<void> }>,
  ): Promise<ScheduledJobBatchResult & Readonly<{ batches: number }>> {
    const startedAt = this.monotonicNow();
    if (!Number.isFinite(startedAt)) throw new TypeError("Scheduled job monotonic clock returned an invalid value");
    let cursor = initialCursor;
    let processed = 0;
    let hasMore = true;
    let batches = 0;
    while (hasMore && batches < MAX_BATCHES_PER_RUN) {
      if (batches > 0 && this.monotonicNow() - startedAt >= MAX_RUN_DURATION_MS) break;
      const execution = await this.runLeased(name, nowDate, audit, cursor);
      assertBatchResult(execution, this.maximumFor(name), name);
      processed += execution.processed;
      hasMore = execution.hasMore;
      batches += 1;
      if (name === "recurrence-materialization") {
        if (!("nextTemplateCursor" in execution)) {
          throw new TypeError("Recurrence materialization must return its next keyset cursor");
        }
        const nextCursor = execution.nextTemplateCursor;
        if (nextCursor !== null && typeof nextCursor !== "string") {
          throw new TypeError("Recurrence materialization returned an invalid keyset cursor");
        }
        cursor = nextCursor;
        if (!await this.dependencies.leases.writeCursor(name, leaseToken, cursor, this.now().toISOString())) {
          throw new Error("Recurrence materialization lease was lost before saving its cursor");
        }
      }
      if (hasMore && batches < MAX_BATCHES_PER_RUN) await heartbeat.renewNow();
    }
    return { processed, hasMore, batches };
  }

  private maximumFor(name: ScheduledJobName): number {
    switch (name) {
      case "recurrence-materialization":
        return SCHEDULED_JOB_LIMITS.recurrenceMaterialization.templates
          * SCHEDULED_JOB_LIMITS.recurrenceMaterialization.occurrencesPerTemplate;
      case "announcement-publish":
        return SCHEDULED_JOB_LIMITS.announcementPublish;
      case "raffle-auto-draw":
        return SCHEDULED_JOB_LIMITS.raffleAutoDraw;
      case "event-auto-archive":
        return SCHEDULED_JOB_LIMITS.eventAutoArchive;
      case "media-gc":
        return SCHEDULED_JOB_LIMITS.mediaGarbageCollection;
      case "audit-archive":
        return SCHEDULED_JOB_LIMITS.auditArchive;
      case "session-cleanup":
        return SCHEDULED_JOB_LIMITS.sessionCleanup;
      case "system-test-cleanup":
        return SCHEDULED_JOB_LIMITS.systemTestCleanup;
    }
  }

  async runMany(names: readonly ScheduledJobName[]): Promise<readonly ScheduledJobOutcome[]> {
    const outcomes: ScheduledJobOutcome[] = [];
    for (const name of names) {
      try {
        outcomes.push(await this.run(name));
      } catch (error) {
        const message = errorMessage(error);
        outcomes.push({
          name,
          status: "failed",
          processed: null,
          hasMore: null,
          batches: null,
          backlog: unknownBacklog("job-failed", message),
          error: message,
        });
      }
    }
    return outcomes;
  }

  runSchedule(schedule: ScheduledJobSchedule): Promise<readonly ScheduledJobOutcome[]> {
    return this.runMany(SCHEDULED_JOB_GROUPS[schedule]);
  }

  private inspectBacklog(name: ScheduledJobName, nowDate: Date): Promise<ScheduledJobBacklog> {
    const now = nowDate.toISOString();
    switch (name) {
      case "recurrence-materialization":
        return this.dependencies.recurrenceMaterialization.inspectBacklog({ now });
      case "announcement-publish":
        return this.dependencies.announcementPublish.inspectBacklog({ now });
      case "raffle-auto-draw":
        return this.dependencies.raffleAutoDraw.inspectBacklog({ now });
      case "event-auto-archive":
        return this.dependencies.eventAutoArchive.inspectBacklog({ now });
      case "media-gc":
        return this.dependencies.mediaGarbageCollection.inspectBacklog({ before: now });
      case "audit-archive":
        return this.dependencies.auditArchive.inspectBacklog({ before: auditArchiveCutoff(nowDate) });
      case "session-cleanup":
        return this.dependencies.sessionCleanup.inspectBacklog({
          expiresBefore: now,
          createdBefore: new Date(nowDate.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString(),
        });
      case "system-test-cleanup":
        return this.dependencies.systemTestCleanup.inspectBacklog({ before: now });
    }
  }

  private async runLeased(
    name: ScheduledJobName,
    nowDate: Date,
    audit: SchedulerAuditFactory,
    afterTemplateId: string | null,
  ): Promise<ScheduledJobBatchResult & Partial<Readonly<{ nextTemplateCursor: string | null }>>> {
    const now = nowDate.toISOString();
    let result: ScheduledJobBatchResult;
    switch (name) {
      case "recurrence-materialization":
        result = await this.dependencies.recurrenceMaterialization.run({
          now,
          afterTemplateId,
          maxTemplates: SCHEDULED_JOB_LIMITS.recurrenceMaterialization.templates,
          maxOccurrencesPerTemplate: SCHEDULED_JOB_LIMITS.recurrenceMaterialization.occurrencesPerTemplate,
          audit,
        });
        break;
      case "announcement-publish":
        result = await this.dependencies.announcementPublish.run({
          now,
          limit: SCHEDULED_JOB_LIMITS.announcementPublish,
          audit,
        });
        break;
      case "raffle-auto-draw":
        result = await this.dependencies.raffleAutoDraw.run({
          now,
          limit: SCHEDULED_JOB_LIMITS.raffleAutoDraw,
          audit,
        });
        break;
      case "event-auto-archive":
        result = await this.dependencies.eventAutoArchive.run({
          now,
          limit: SCHEDULED_JOB_LIMITS.eventAutoArchive,
          audit,
        });
        break;
      case "media-gc":
        result = await this.dependencies.mediaGarbageCollection.run({
          before: now,
          limit: SCHEDULED_JOB_LIMITS.mediaGarbageCollection,
          audit,
        });
        break;
      case "audit-archive":
        result = await this.dependencies.auditArchive.run({
          before: auditArchiveCutoff(nowDate),
          now,
          limit: SCHEDULED_JOB_LIMITS.auditArchive,
          audit,
        });
        break;
      case "session-cleanup":
        result = await this.dependencies.sessionCleanup.run({
          expiresBefore: now,
          createdBefore: new Date(nowDate.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString(),
          limit: SCHEDULED_JOB_LIMITS.sessionCleanup,
          audit,
        });
        break;
      case "system-test-cleanup":
        result = await this.dependencies.systemTestCleanup.run({
          before: now,
          limit: SCHEDULED_JOB_LIMITS.systemTestCleanup,
        });
        break;
    }
    return result;
  }
}
