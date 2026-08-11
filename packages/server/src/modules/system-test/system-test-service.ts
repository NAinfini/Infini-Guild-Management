import { AppError, type BlobStore, type RequestContext, type ScheduledJobBacklog } from "@guild/kernel";
import type {
  SystemTestArtifactType,
  SystemTestSummary,
} from "@guild/shared/schemas/system-test";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { createAuditMutation, type AuditMutation } from "../audit/public.js";

const RUN_TTL_MS = 24 * 60 * 60 * 1_000;
const CLEANUP_PAGE = 50;
const MAX_EXPIRED_RUNS = 50;

export type SystemTestRunStatus = "running" | "cleaning" | "cleanup_failed" | "completed";

export type SystemTestRunRecord = Readonly<{
  id: string;
  actorUserId: string;
  status: SystemTestRunStatus;
  cleanupAttempts: number;
}>;

export type SystemTestArtifact = Readonly<{
  type: SystemTestArtifactType;
  key: string;
}>;

export type SystemTestBeforeImage = Readonly<{
  type: "class_catalog" | "class_tag" | "badge";
  key: string;
}>;

export interface SystemTestStore {
  createRun(input: Readonly<{
    id: string;
    actorUserId: string;
    createdAt: string;
    expiresAt: string;
  }>): Promise<void>;
  getRun(id: string): Promise<SystemTestRunRecord | null>;
  beginRequest(input: Readonly<{
    runId: string;
    requestId: string;
    actorUserId: string | null;
    allowAnonymous: boolean;
    startedAt: string;
  }>): Promise<boolean>;
  endRequest(requestId: string): Promise<void>;
  isActiveRequest(requestId: string): Promise<boolean>;
  claimCleanup(runId: string, at: string): Promise<boolean>;
  listArtifacts(runId: string, limit: number): Promise<readonly SystemTestArtifact[]>;
  completeCleanup(runId: string, at: string): Promise<boolean>;
  failCleanup(runId: string, message: string, at: string): Promise<void>;
  listExpiredRunIds(before: string, limit: number): Promise<readonly string[]>;
  inspectExpiredBacklog(before: string): Promise<ScheduledJobBacklog>;
  expireRequests(runId: string, before: string): Promise<void>;
  finalizeRun(input: Readonly<{
    runId: string;
    actorUserId: string;
    audit: AuditMutation | null;
  }>): Promise<boolean>;
}

export interface SystemTestArtifactCleaner {
  listMediaObjectKeys(mediaId: string): Promise<readonly string[]>;
  deleteArtifact(runId: string, artifact: SystemTestArtifact): Promise<void>;
  listBeforeImages(runId: string, limit: number): Promise<readonly SystemTestBeforeImage[]>;
  restoreBeforeImage(runId: string, image: SystemTestBeforeImage): Promise<void>;
}

export class SystemTestService {
  constructor(
    private readonly store: SystemTestStore,
    private readonly artifacts: SystemTestArtifactCleaner,
    private readonly blobs: BlobStore,
  ) {}

  async createRun(context: RequestContext): Promise<Readonly<{ runId: string; fixtureId: string }>> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    const runId = crypto.randomUUID();
    await this.store.createRun({
      id: runId,
      actorUserId: actor.userId,
      createdAt: context.now,
      expiresAt: new Date(Date.parse(context.now) + RUN_TTL_MS).toISOString(),
    });
    return { runId, fixtureId: crypto.randomUUID() };
  }

  async beginRequest(context: RequestContext, runId: string, allowAnonymous = false): Promise<void> {
    const accepted = await this.store.beginRequest({
      runId,
      requestId: context.requestId,
      actorUserId: context.authorization.actor?.userId ?? null,
      allowAnonymous,
      startedAt: context.now,
    });
    if (!accepted) throw forbidden("A valid active system-test run bound to this actor is required");
  }

  endRequest(requestId: string): Promise<void> {
    return this.store.endRequest(requestId);
  }

  isActiveRequest(requestId: string): Promise<boolean> {
    return this.store.isActiveRequest(requestId);
  }

  async cleanupRun(context: RequestContext, runId: string): Promise<Readonly<{
    ok: boolean;
    status: SystemTestRunStatus;
    attempts: number;
  }>> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    return this.cleanup(runId, actor.userId, context.now);
  }

  async finalizeRun(context: RequestContext, runId: string, summary?: SystemTestSummary): Promise<void> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    const run = await this.requiredOwnedRun(runId, actor.userId);
    if (run.status !== "completed") throw conflict(`System test run is not ready to finalize (${run.status})`);
    const audit = summary ? createAuditMutation(context, {
      entityType: "system_test",
      entityId: "admin-console-api",
      action: "run",
      summary: `Full system test: ${summary.passed}/${summary.total} passed`,
      details: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        errors: summary.errors,
      },
    }) : null;
    if (!await this.store.finalizeRun({ runId, actorUserId: actor.userId, audit })) {
      throw conflict("System test run still has registered artifacts or active requests");
    }
  }

  async cleanupExpired(before: string, limit = 25): Promise<Readonly<{
    processed: number;
    completed: number;
    failed: number;
  }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPIRED_RUNS || !Number.isFinite(Date.parse(before))) {
      throw new TypeError(`Expired system-test cleanup limit must be between 1 and ${MAX_EXPIRED_RUNS}`);
    }
    const runIds = await this.store.listExpiredRunIds(before, limit);
    let completed = 0;
    let failed = 0;
    for (const runId of runIds) {
      await this.store.expireRequests(runId, before);
      const result = await this.cleanup(runId, null, before);
      if (result.status === "completed") completed += 1;
      if (result.status === "cleanup_failed") failed += 1;
    }
    return { processed: runIds.length, completed, failed };
  }

  inspectExpiredBacklog(before: string): Promise<ScheduledJobBacklog> {
    return this.store.inspectExpiredBacklog(before);
  }

  private async cleanup(runId: string, actorUserId: string | null, at: string) {
    const run = actorUserId ? await this.requiredOwnedRun(runId, actorUserId) : await this.requiredRun(runId);
    if (run.status === "completed") return { ok: true, status: run.status, attempts: run.cleanupAttempts } as const;
    if (!await this.store.claimCleanup(runId, at)) {
      const current = await this.requiredRun(runId);
      return { ok: false, status: current.status, attempts: current.cleanupAttempts };
    }

    try {
      const artifacts = await this.store.listArtifacts(runId, CLEANUP_PAGE);
      for (const artifact of artifacts) {
        if (artifact.type === "media_asset") {
          await this.blobs.delete(await this.artifacts.listMediaObjectKeys(artifact.key));
        }
        await this.artifacts.deleteArtifact(runId, artifact);
      }
      if (artifacts.length === 0) {
        const beforeImages = await this.artifacts.listBeforeImages(runId, CLEANUP_PAGE);
        for (const image of beforeImages) await this.artifacts.restoreBeforeImage(runId, image);
      }
      if (await this.store.completeCleanup(runId, at)) {
        const completed = await this.requiredRun(runId);
        return { ok: true, status: completed.status, attempts: completed.cleanupAttempts };
      }
      const current = await this.requiredRun(runId);
      return { ok: false, status: "cleaning" as const, attempts: current.cleanupAttempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.failCleanup(runId, message.slice(0, 1_000), at);
      const failed = await this.requiredRun(runId);
      return { ok: false, status: failed.status, attempts: failed.cleanupAttempts };
    }
  }

  private async requiredOwnedRun(id: string, actorUserId: string): Promise<SystemTestRunRecord> {
    const run = await this.requiredRun(id);
    if (run.actorUserId !== actorUserId) throw forbidden("System test run belongs to another actor");
    return run;
  }

  private async requiredRun(id: string): Promise<SystemTestRunRecord> {
    const run = await this.store.getRun(id);
    if (!run) throw new AppError({ code: "NOT_FOUND", status: 404, message: "System test run not found" });
    return run;
  }
}

function forbidden(message: string): AppError {
  return new AppError({ code: "FORBIDDEN", status: 403, message });
}

function conflict(message: string): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message });
}
