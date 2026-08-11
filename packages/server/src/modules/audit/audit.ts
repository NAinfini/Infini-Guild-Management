import type { AuditLogEntry, JsonObject, PaginatedResponse } from "@guild/shared";
import type { AuditAction, AuditEntityType } from "@guild/shared/constants/audit";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { jsonObjectSchema } from "@guild/shared";
import type { RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import { assertPortableLikeSearch } from "../../portable-search.js";

const MAX_AUDIT_DETAIL_BYTES = 16_384;
const MAX_AUDIT_SUMMARY_LENGTH = 200;

export type AuditMutation = Readonly<{
  id: string;
  requestId: string;
  actorUserId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  summary: string | null;
  details: JsonObject | null;
  occurredAt: string;
}>;

export type AuditQuery = Readonly<{
  page: number;
  limit: number;
  search?: string;
  startAt?: string;
  endAt?: string;
  entityType?: AuditEntityType;
  actorUserId?: string;
}>;

export interface AuditStore {
  list(query: AuditQuery): Promise<PaginatedResponse<AuditLogEntry>>;
  export(query: Omit<AuditQuery, "page" | "limit">): AsyncIterable<AuditLogEntry>;
  recordExport(audit: AuditMutation): Promise<void>;
}

export function createAuditMutation(
  context: RequestContext,
  input: Readonly<{
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    summary?: string | null;
    details?: JsonObject | null;
  }>,
): AuditMutation {
  const actor = context.authorization.requireAuthenticated();
  return createAuditMutationForActor(context, actor.userId, input);
}

/** Auth uses this only when the actor is created by the same registration transaction. */
export function createAuditMutationForActor(
  context: RequestContext,
  actorUserIdInput: string,
  input: Readonly<{
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    summary?: string | null;
    details?: JsonObject | null;
  }>,
): AuditMutation {
  const actorUserId = actorUserIdInput.trim();
  const entityId = input.entityId.trim();
  const summary = input.summary?.trim() || null;
  const details = input.details == null ? null : jsonObjectSchema.parse(input.details);

  if (!actorUserId || !entityId) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Audit actor and entity ids are required",
    });
  }
  if (summary && summary.length > MAX_AUDIT_SUMMARY_LENGTH) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Audit summary is too long",
    });
  }
  if (details && new TextEncoder().encode(JSON.stringify(details)).byteLength > MAX_AUDIT_DETAIL_BYTES) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Audit details are too large",
    });
  }

  return Object.freeze({
    id: crypto.randomUUID(),
    requestId: context.requestId,
    actorUserId,
    entityType: input.entityType,
    entityId,
    action: input.action,
    summary,
    details,
    occurredAt: context.now,
  });
}

export class AuditService {
  constructor(private readonly store: AuditStore) {}

  list(context: RequestContext, query: AuditQuery): Promise<PaginatedResponse<AuditLogEntry>> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_VIEW);
    assertAuditQuery(query);
    return this.store.list(query);
  }

  export(
    context: RequestContext,
    query: Omit<AuditQuery, "page" | "limit">,
  ): AsyncIterable<AuditLogEntry> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    assertAuditQuery({ ...query, page: 1, limit: 1 });
    return this.store.export(query);
  }

  recordExport(
    context: RequestContext,
    format: "csv" | "json",
    query: Omit<AuditQuery, "page" | "limit">,
  ): Promise<void> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    assertAuditQuery({ ...query, page: 1, limit: 1 });
    return this.store.recordExport(createAuditMutation(context, {
      entityType: "audit_log_export",
      entityId: context.requestId,
      action: format === "csv" ? "export_filtered_csv" : "export_filtered_json",
      summary: `Filtered ${format.toUpperCase()} audit export`,
      details: {
        ...optionalDetail("entityType", query.entityType),
        ...optionalDetail("actorUserId", query.actorUserId),
        ...optionalDetail("search", query.search),
        ...optionalDetail("startAt", query.startAt),
        ...optionalDetail("endAt", query.endAt),
      },
    }));
  }
}

function optionalDetail<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return value === undefined ? {} : { [key]: value } as { [P in K]?: string };
}

function assertAuditQuery(query: AuditQuery): void {
  if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Invalid audit pagination",
    });
  }
  assertPortableLikeSearch(query.search?.toLowerCase(), "Audit search");
  if (query.startAt && query.endAt && query.startAt > query.endAt) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Audit date range is invalid",
    });
  }
}
