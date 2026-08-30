import {
  type AuditChange,
  type ImportantNotice,
  type ImportantNoticeActive,
  type ImportantNoticeAudienceRole,
  type ImportantNoticeAudienceScope,
  type ImportantNoticeStatus,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import {
  MAX_ACTIVE_IMPORTANT_NOTICE_BODY_CHARACTERS,
  MAX_ACTIVE_IMPORTANT_NOTICES,
} from "@guild/shared/constants/important-notices";
import {
  AppError,
  type DeferredTasks,
  type NotificationPublisher,
  type RequestContext,
} from "@guild/kernel";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";

export type ImportantNoticeRecord = Omit<ImportantNotice, "revision_token"> & Readonly<{
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
  listAudienceRoles(): Promise<readonly ImportantNoticeAudienceRole[]>;
  listActive(input: Readonly<{ userId: string; roleId: string; now: string }>): Promise<readonly ImportantNoticeActive[]>;
  markRead(input: Readonly<{
    userId: string;
    roleId: string;
    ids: readonly string[] | null;
    now: string;
  }>): Promise<number>;
  acknowledge(input: Readonly<{
    userId: string;
    roleId: string;
    id: string;
    now: string;
  }>): Promise<boolean>;
}

export type ImportantNoticeWriteInput = Readonly<{
  expected_revision_token: string;
  title?: string;
  body_json?: string;
  publish_at?: string | null;
  expires_at?: string | null;
  requires_acknowledgement?: boolean;
  audience_scope?: ImportantNoticeAudienceScope;
  audience_role_ids?: readonly string[];
}>;

export class ImportantNoticeService {
  constructor(
    private readonly store: ImportantNoticeStore,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

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

  listAudienceRoles(context: RequestContext): Promise<readonly ImportantNoticeAudienceRole[]> {
    context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    return this.store.listAudienceRoles();
  }

  async create(
    context: RequestContext,
    input: Readonly<{
      title: string;
      body_json: string;
      status: Extract<ImportantNoticeStatus, "draft" | "scheduled">;
      publish_at?: string;
      expires_at?: string | null;
      requires_acknowledgement: boolean;
      audience_scope: ImportantNoticeAudienceScope;
      audience_role_ids: readonly string[];
    }>,
  ): Promise<ImportantNotice> {
    const actor = context.authorization.require(PERMISSION_ID.ADMIN_IMPORTANT_NOTICES_MANAGE);
    const state = createState(input.status, input.publish_at, input.expires_at ?? null, context.now);
    const audience = await this.validateAudience(input.audience_scope, input.audience_role_ids);
    if (state.status === "scheduled") await this.requireDeliveryCapacity(context.now);
    const record: ImportantNoticeRecord = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      body_json: input.body_json,
      status: state.status,
      publish_at: state.publishAt,
      expires_at: state.expiresAt,
      publication_revision: state.publicationRevision,
      requires_acknowledgement: input.requires_acknowledgement,
      audience_scope: audience.scope,
      audience_role_ids: audience.roleIds,
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
    if (input.expected_revision_token !== existing.revisionToken) {
      throw conflict("Important notice changed");
    }
    if (isActive(existing, context.now)) {
      throw conflict("Withdraw the published important notice before editing it");
    }
    const publishAt = input.publish_at === undefined
      ? existing.status === "withdrawn" ? null : existing.publish_at
      : input.publish_at;
    const expiresAt = input.expires_at === undefined ? existing.expires_at : input.expires_at;
    const status = publishAt === null ? "draft" : "scheduled";
    const state = createState(status, publishAt ?? undefined, expiresAt, context.now);
    const audience = input.audience_scope === undefined && input.audience_role_ids === undefined
      ? { scope: existing.audience_scope, roleIds: [...existing.audience_role_ids] }
      : await this.validateAudienceUpdate(input.audience_scope, input.audience_role_ids);
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
      requires_acknowledgement: input.requires_acknowledgement ?? existing.requires_acknowledgement,
      audience_scope: audience.scope,
      audience_role_ids: audience.roleIds,
      revisionToken: crypto.randomUUID(),
      updatedBy: actor.userId,
      updated_at: context.now,
    };
    if (sameEditableState(existing, record)) return withoutInternal(existing, context.now);
    if (record.status === "scheduled") await this.requireDeliveryCapacity(context.now, record.id);
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
    await this.requireDeliveryCapacity(context.now, existing.id);
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
    this.publishInboxChanged();
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
    this.publishInboxChanged();
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

  async listActive(context: RequestContext): Promise<readonly ImportantNoticeActive[]> {
    const actor = context.authorization.requireAuthenticated();
    const notices = await this.store.listActive({ userId: actor.userId, roleId: actor.roleId, now: context.now });
    const bodyCharacters = notices.reduce((total, notice) => total + notice.body_json.length, 0);
    if (notices.length > MAX_ACTIVE_IMPORTANT_NOTICES
      || bodyCharacters > MAX_ACTIVE_IMPORTANT_NOTICE_BODY_CHARACTERS) {
      throw new AppError({
        code: "SERVER_ERROR",
        status: 500,
        message: "Active important notice delivery exceeds its bounded response budget",
      });
    }
    return notices;
  }

  async markRead(
    context: RequestContext,
    input: Readonly<{ ids?: readonly string[]; all?: true }>,
  ): Promise<Readonly<{ updated: number }>> {
    const actor = context.authorization.requireAuthenticated();
    const updated = await this.store.markRead({
      userId: actor.userId,
      roleId: actor.roleId,
      ids: input.all === true ? null : input.ids ?? [],
      now: context.now,
    });
    if (updated > 0) this.publishInboxChanged(actor.userId);
    return { updated };
  }

  async acknowledge(context: RequestContext, id: string): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.requireAuthenticated();
    if (!await this.store.acknowledge({
      userId: actor.userId,
      roleId: actor.roleId,
      id,
      now: context.now,
    })) throw notFound();
    this.publishInboxChanged(actor.userId);
    return { ok: true };
  }

  private publishInboxChanged(userId?: string): void {
    this.deferred.defer(() => this.notifications.publish({
      type: "inbox_changed",
      ...(userId === undefined ? {} : { user_id: userId }),
    }));
  }

  private async validateAudienceUpdate(
    scope: ImportantNoticeAudienceScope | undefined,
    roleIds: readonly string[] | undefined,
  ): Promise<Readonly<{ scope: ImportantNoticeAudienceScope; roleIds: string[] }>> {
    if (scope === undefined || roleIds === undefined) {
      throw validation("Audience scope and role IDs must be updated together");
    }
    return this.validateAudience(scope, roleIds);
  }

  private async requireDeliveryCapacity(now: string, excludedNoticeId?: string): Promise<void> {
    const deliverableCount = (await this.store.list()).filter((record) => (
      record.id !== excludedNoticeId
      && (record.status === "scheduled" || record.status === "published")
      && (record.expires_at === null || record.expires_at > now)
    )).length;
    if (deliverableCount >= MAX_ACTIVE_IMPORTANT_NOTICES) {
      throw conflict(`At most ${MAX_ACTIVE_IMPORTANT_NOTICES} notices may be published or scheduled at once`);
    }
  }

  private async validateAudience(
    scope: ImportantNoticeAudienceScope,
    roleIdsInput: readonly string[],
  ): Promise<Readonly<{ scope: ImportantNoticeAudienceScope; roleIds: string[] }>> {
    const roleIds = [...roleIdsInput].sort();
    if (new Set(roleIds).size !== roleIds.length) throw validation("Audience role IDs must be unique");
    if (scope === "all") {
      if (roleIds.length > 0) throw validation("All-member notices cannot select audience roles");
      return { scope, roleIds };
    }
    if (roleIds.length === 0) throw validation("Role-targeted notices require at least one audience role");
    const availableRoleIds = new Set((await this.store.listAudienceRoles()).map((role) => role.id));
    if (roleIds.some((roleId) => !availableRoleIds.has(roleId))) {
      throw validation("Important notice audience contains an unknown role");
    }
    return { scope, roleIds };
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
  expiresAtInput: string | null,
  now: string,
): Readonly<{ status: "draft" | "scheduled"; publishAt: string | null; expiresAt: string | null; publicationRevision: number }> {
  const expiresAt = expiresAtInput === null ? null : canonicalTimestamp(expiresAtInput, "expiry");
  if (status === "draft") {
    if (publishAtInput !== undefined) throw validation("Draft important notices cannot have a publish time");
    return { status, publishAt: null, expiresAt, publicationRevision: 0 };
  }
  if (!publishAtInput) throw validation("Scheduled publish time must be in the future");
  const publishAt = canonicalTimestamp(publishAtInput, "publish time");
  if (publishAt <= now) throw validation("Scheduled publish time must be in the future");
  if (expiresAt !== null && expiresAt <= publishAt) throw validation("Important notice expiry must be after publication");
  return { status, publishAt, expiresAt, publicationRevision: 1 };
}

function canonicalTimestamp(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw validation(`Important notice ${label} is invalid`);
  return new Date(milliseconds).toISOString();
}

function isActive(record: ImportantNoticeRecord, now: string): boolean {
  return (record.status === "scheduled" || record.status === "published")
    && record.publish_at !== null
    && record.publish_at <= now
    && (record.expires_at === null || record.expires_at > now);
}

function withoutInternal(record: ImportantNoticeRecord, now: string): ImportantNotice {
  const { revisionToken, createdBy: _createdBy, updatedBy: _updatedBy, ...notice } = record;
  return {
    ...notice,
    revision_token: revisionToken,
    status: record.status === "scheduled" && record.publish_at !== null && record.publish_at <= now
      ? "published"
      : record.status,
  };
}

function sameEditableState(before: ImportantNoticeRecord, after: ImportantNoticeRecord): boolean {
  return before.title === after.title
    && before.body_json === after.body_json
    && before.status === after.status
    && before.publish_at === after.publish_at
    && before.expires_at === after.expires_at
    && before.publication_revision === after.publication_revision
    && before.requires_acknowledgement === after.requires_acknowledgement
    && before.audience_scope === after.audience_scope
    && sameStrings(before.audience_role_ids, after.audience_role_ids);
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
    { field: "requires_acknowledgement" as const, value: {
      type: "boolean" as const,
      value: record.requires_acknowledgement,
    } },
    { field: "audience_scope" as const, value: { type: "code" as const, value: record.audience_scope } },
    { field: "audience_role_ids" as const, value: auditRoleIds(record.audience_role_ids) },
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
  if (before.requires_acknowledgement !== after.requires_acknowledgement) changes.push({
    field: "requires_acknowledgement",
    before: { type: "boolean", value: before.requires_acknowledgement },
    after: { type: "boolean", value: after.requires_acknowledgement },
  });
  if (before.audience_scope !== after.audience_scope) changes.push({
    field: "audience_scope",
    before: { type: "code", value: before.audience_scope },
    after: { type: "code", value: after.audience_scope },
  });
  if (!sameStrings(before.audience_role_ids, after.audience_role_ids)) changes.push({
    field: "audience_role_ids",
    before: auditRoleIds(before.audience_role_ids),
    after: auditRoleIds(after.audience_role_ids),
  });
  return changes;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function auditRoleIds(roleIds: readonly string[]) {
  return { type: "list" as const, value: roleIds.map((value) => ({ type: "code" as const, value })) };
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
