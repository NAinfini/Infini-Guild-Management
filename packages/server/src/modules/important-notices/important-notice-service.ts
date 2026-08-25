import {
  type AuditChange,
  type ImportantNotice,
  type ImportantNoticeAcknowledgement,
  type ImportantNoticeActive,
  type ImportantNoticeStatus,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { AppError, type RequestContext } from "@guild/kernel";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";

export type ImportantNoticeRecord = ImportantNotice & Readonly<{
  revisionToken: string;
  createdBy: string;
  updatedBy: string | null;
}>;

export interface ImportantNoticeStore {
  list(): Promise<readonly ImportantNoticeRecord[]>;
  get(id: string): Promise<ImportantNoticeRecord | null>;
  create(input: Readonly<{ record: ImportantNoticeRecord; audit: AuditEventWrite }>): Promise<void>;
  update(input: Readonly<{
    record: ImportantNoticeRecord;
    expectedRevisionToken: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  delete(input: Readonly<{ id: string; expectedRevisionToken: string; audit: AuditEventWrite }>): Promise<boolean>;
  listActive(now: string): Promise<readonly ImportantNoticeActive[]>;
  listAcknowledgements(userId: string, now: string): Promise<readonly ImportantNoticeAcknowledgement[]>;
  acknowledge(input: Readonly<{
    userId: string;
    id: string;
    publicationRevision: number;
    now: string;
  }>): Promise<boolean>;
}

export type ImportantNoticeWriteInput = Readonly<{
  title?: string;
  body_json?: string;
  publish_at?: string | null;
  expires_at?: string | null;
}>;

export class ImportantNoticeService {
  constructor(private readonly store: ImportantNoticeStore) {}

  listAdmin(context: RequestContext): Promise<readonly ImportantNotice[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    return this.store.list().then((records) => records.map((record) => withoutInternal(record, context.now)));
  }

  async getAdmin(context: RequestContext, id: string): Promise<ImportantNotice> {
    context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const record = await this.store.get(id);
    if (!record) throw notFound();
    return withoutInternal(record, context.now);
  }

  async create(
    context: RequestContext,
    input: Readonly<{
      title: string;
      body_json: string;
      status: Extract<ImportantNoticeStatus, "draft" | "scheduled">;
      publish_at?: string;
      expires_at?: string | null;
    }>,
  ): Promise<ImportantNotice> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const state = createState(input.status, input.publish_at, input.expires_at ?? null, context.now);
    const record: ImportantNoticeRecord = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      body_json: input.body_json,
      status: state.status,
      publish_at: state.publishAt,
      expires_at: state.expiresAt,
      publication_revision: state.publicationRevision,
      revisionToken: crypto.randomUUID(),
      createdBy: actor.userId,
      updatedBy: null,
      created_at: context.now,
      updated_at: context.now,
    };
    await this.store.create({ record, audit: createAuditEvent(context, {
      subjectType: "important_notice",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "create",
      context: noticeContext(record),
    }) });
    return withoutInternal(record, context.now);
  }

  async update(context: RequestContext, id: string, input: ImportantNoticeWriteInput): Promise<ImportantNotice> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const existing = await this.requireRecord(id);
    if (isActive(existing, context.now)) {
      throw conflict("Withdraw the published important notice before editing it");
    }
    const publishAt = input.publish_at === undefined
      ? existing.status === "withdrawn" ? null : existing.publish_at
      : input.publish_at;
    const expiresAt = input.expires_at === undefined ? existing.expires_at : input.expires_at;
    const status = publishAt === null ? "draft" : "scheduled";
    const state = createState(status, publishAt ?? undefined, expiresAt, context.now);
    const record: ImportantNoticeRecord = {
      ...existing,
      title: input.title?.trim() ?? existing.title,
      body_json: input.body_json ?? existing.body_json,
      status: state.status,
      publish_at: state.publishAt,
      expires_at: state.expiresAt,
      publication_revision: state.status === "scheduled" && existing.status !== "scheduled"
        ? existing.publication_revision + 1
        : existing.publication_revision,
      revisionToken: crypto.randomUUID(),
      updatedBy: actor.userId,
      updated_at: context.now,
    };
    if (!await this.store.update({ record, expectedRevisionToken: existing.revisionToken, audit: createAuditEvent(context, {
      subjectType: "important_notice",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "update",
      changes: noticeChanges(existing, record),
    }) })) throw conflict("Important notice changed");
    return withoutInternal(record, context.now);
  }

  async publish(context: RequestContext, id: string): Promise<ImportantNotice> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const existing = await this.requireRecord(id);
    if (isActive(existing, context.now)) throw conflict("Important notice is already published");
    if (existing.status !== "draft" && existing.status !== "scheduled" && existing.status !== "withdrawn") {
      throw conflict("Important notice cannot be published");
    }
    if (existing.expires_at !== null && existing.expires_at <= context.now) {
      throw validation("Important notice expiry must be after publication");
    }
    const record: ImportantNoticeRecord = {
      ...existing,
      status: "published",
      publish_at: context.now,
      publication_revision: existing.status === "scheduled"
        ? Math.max(1, existing.publication_revision)
        : existing.publication_revision + 1,
      revisionToken: crypto.randomUUID(),
      updatedBy: actor.userId,
      updated_at: context.now,
    };
    if (!await this.store.update({ record, expectedRevisionToken: existing.revisionToken, audit: createAuditEvent(context, {
      subjectType: "important_notice",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "publish",
      changes: noticeChanges(existing, record),
    }) })) throw conflict("Important notice changed");
    return withoutInternal(record, context.now);
  }

  async withdraw(context: RequestContext, id: string): Promise<ImportantNotice> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const existing = await this.requireRecord(id);
    if (existing.status !== "scheduled" && existing.status !== "published") {
      throw conflict("Important notice is not publishable");
    }
    const record: ImportantNoticeRecord = {
      ...existing,
      status: "withdrawn",
      revisionToken: crypto.randomUUID(),
      updatedBy: actor.userId,
      updated_at: context.now,
    };
    if (!await this.store.update({ record, expectedRevisionToken: existing.revisionToken, audit: createAuditEvent(context, {
      subjectType: "important_notice",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "withdraw",
      changes: noticeChanges(existing, record),
    }) })) throw conflict("Important notice changed");
    return withoutInternal(record, context.now);
  }

  async delete(context: RequestContext, id: string): Promise<Readonly<{ ok: true }>> {
    context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const existing = await this.requireRecord(id);
    if (isActive(existing, context.now)) throw conflict("Withdraw the published important notice before deleting it");
    if (!await this.store.delete({ id, expectedRevisionToken: existing.revisionToken, audit: createAuditEvent(context, {
      subjectType: "important_notice",
      subjectId: existing.id,
      subjectLabel: existing.title,
      action: "delete",
      context: noticeContext(existing),
    }) })) throw conflict("Important notice changed");
    return { ok: true };
  }

  listActive(context: RequestContext): Promise<readonly ImportantNoticeActive[]> {
    return this.store.listActive(context.now);
  }

  async listAcknowledgements(context: RequestContext): Promise<readonly ImportantNoticeAcknowledgement[]> {
    const actor = context.authorization.requireAuthenticated();
    return this.store.listAcknowledgements(actor.userId, context.now);
  }

  async acknowledge(
    context: RequestContext,
    id: string,
    publicationRevision: number,
  ): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.requireAuthenticated();
    if (!await this.store.acknowledge({
      userId: actor.userId,
      id,
      publicationRevision,
      now: context.now,
    })) throw notFound();
    return { ok: true };
  }

  private async requireRecord(id: string): Promise<ImportantNoticeRecord> {
    const record = await this.store.get(id);
    if (!record) throw notFound();
    return record;
  }
}

function createState(
  status: Extract<ImportantNoticeStatus, "draft" | "scheduled">,
  publishAtInput: string | undefined,
  expiresAt: string | null,
  now: string,
): Readonly<{ status: "draft" | "scheduled"; publishAt: string | null; expiresAt: string | null; publicationRevision: number }> {
  if (status === "draft") {
    if (publishAtInput !== undefined) throw validation("Draft important notices cannot have a publish time");
    return { status, publishAt: null, expiresAt, publicationRevision: 0 };
  }
  if (!publishAtInput || publishAtInput <= now) throw validation("Scheduled publish time must be in the future");
  if (expiresAt !== null && expiresAt <= publishAtInput) throw validation("Important notice expiry must be after publication");
  return { status, publishAt: publishAtInput, expiresAt, publicationRevision: 1 };
}

function isActive(record: ImportantNoticeRecord, now: string): boolean {
  return (record.status === "scheduled" || record.status === "published")
    && record.publish_at !== null
    && record.publish_at <= now
    && (record.expires_at === null || record.expires_at > now);
}

function withoutInternal(record: ImportantNoticeRecord, now: string): ImportantNotice {
  const { revisionToken: _revisionToken, createdBy: _createdBy, updatedBy: _updatedBy, ...notice } = record;
  return {
    ...notice,
    status: record.status === "scheduled" && record.publish_at !== null && record.publish_at <= now
      ? "published"
      : record.status,
  };
}

function noticeContext(record: ImportantNoticeRecord) {
  return [
    { field: "status" as const, value: { type: "code" as const, value: record.status } },
    { field: "publish_at" as const, value: record.publish_at === null
      ? { type: "null" as const, value: null }
      : { type: "datetime" as const, value: record.publish_at } },
    { field: "expires_at" as const, value: record.expires_at === null
      ? { type: "null" as const, value: null }
      : { type: "datetime" as const, value: record.expires_at } },
    { field: "publication_revision" as const, value: { type: "number" as const, value: record.publication_revision } },
  ];
}

function noticeChanges(before: ImportantNoticeRecord, after: ImportantNoticeRecord): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.title !== after.title) changes.push({
    field: "title", before: { type: "text", value: before.title }, after: { type: "text", value: after.title },
  });
  if (before.status !== after.status) changes.push({
    field: "status", before: { type: "code", value: before.status }, after: { type: "code", value: after.status },
  });
  if (before.publish_at !== after.publish_at) changes.push({
    field: "publish_at",
    before: before.publish_at === null ? { type: "null", value: null } : { type: "datetime", value: before.publish_at },
    after: after.publish_at === null ? { type: "null", value: null } : { type: "datetime", value: after.publish_at },
  });
  if (before.expires_at !== after.expires_at) changes.push({
    field: "expires_at",
    before: before.expires_at === null ? { type: "null", value: null } : { type: "datetime", value: before.expires_at },
    after: after.expires_at === null ? { type: "null", value: null } : { type: "datetime", value: after.expires_at },
  });
  if (before.publication_revision !== after.publication_revision) changes.push({
    field: "publication_revision",
    before: { type: "number", value: before.publication_revision },
    after: { type: "number", value: after.publication_revision },
  });
  return changes;
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function notFound(): AppError {
  return new AppError({ code: "NOT_FOUND", status: 404, message: "Important notice not found" });
}

function conflict(message: string): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message });
}
