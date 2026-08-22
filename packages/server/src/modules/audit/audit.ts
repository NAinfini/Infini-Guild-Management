import { AppError, type RequestContext } from "@guild/kernel";
import {
  auditPayloadV2Schema,
  type AuditChange,
  type AuditContext,
  type AuditEvent,
  type AuditPayloadV2,
  type AuditValue,
  type CursorResponse,
} from "@guild/shared";
import {
  AUDIT_CODE_VALUES,
  AUDIT_ENTITY_TYPES,
  AUDIT_FIELDS,
  AUDIT_SECTION_KEYS,
  type AuditAction,
  type AuditEntityType,
  type AuditField,
} from "@guild/shared/constants/audit";
import { PERMISSION_ID, PERMISSIONS } from "@guild/shared/constants/roles";
import { assertPortableLikeSearch } from "../../portable-search.js";

const MAX_AUDIT_PAYLOAD_BYTES = 32_768;
const MAX_AUDIT_LABEL_LENGTH = 200;
const TECHNICAL_REFERENCE_FIELDS = new Set<AuditField>(["actor_id", "subject_id"]);
const AUDIT_CODE_VALUE_SET = new Set<string>(AUDIT_CODE_VALUES);
const AUDIT_ENTITY_TYPE_SET = new Set<string>(AUDIT_ENTITY_TYPES);
const AUDIT_FIELD_SET = new Set<string>(AUDIT_FIELDS);
const AUDIT_SECTION_SET = new Set<string>(AUDIT_SECTION_KEYS);
const PERMISSION_SET = new Set<string>(PERMISSIONS);
const FREEFORM_CODE_FIELDS = new Set<AuditField>(["color", "icon", "role_tags", "slug"]);
const PERMISSION_FIELDS = new Set<AuditField>(["permissions", "permissions_added", "permissions_removed"]);
const RUNTIME_RESTRICTED_FIELDS = new Set<AuditField>([
  "body",
  "errors",
]);

export type AuditEventWrite = Readonly<{
  eventId: string;
  requestId: string;
  actorKind: "user" | "system";
  actorId: string;
  actorLabel: string | null;
  subjectType: AuditEntityType;
  subjectId: string;
  subjectLabel: string | null;
  action: AuditAction;
  payload: AuditPayloadV2;
  occurredAt: string;
}>;

export type AuditEventInput = Readonly<{
  subjectType: AuditEntityType;
  subjectId: string;
  subjectLabel?: string | null;
  action: AuditAction;
  changes?: readonly AuditChange[];
  context?: readonly AuditContext[];
}>;

export type AuditFilter = Readonly<{
  search?: string;
  startAt?: string;
  endAt?: string;
  subjectType?: AuditEntityType;
  subjectId?: string;
  actorId?: string;
}>;

export type AuditQuery = AuditFilter & Readonly<{
  limit: number;
  cursor?: string;
}>;

export type AuditCursor = Readonly<{ occurredAt: string; eventId: string }>;

export type AuditStoreQuery = AuditFilter & Readonly<{
  limit: number;
  cursor: AuditCursor | null;
}>;

export type AuditStorePage = Readonly<{
  data: AuditEvent[];
  hasMore: boolean;
}>;

export interface AuditStore {
  list(query: AuditStoreQuery): Promise<AuditStorePage>;
  export(query: AuditFilter): AsyncIterable<AuditEvent>;
  recordExport(audit: AuditEventWrite): Promise<void>;
}

export function createAuditEvent(context: RequestContext, input: AuditEventInput): AuditEventWrite {
  const actor = context.authorization.requireAuthenticated();
  return createAuditEventForActor(context, { kind: "user", id: actor.userId, label: null }, input);
}

/** Registration uses this when the actor is inserted by the same transaction. */
export function createAuditEventForUser(
  context: RequestContext,
  actorUserId: string,
  input: AuditEventInput,
): AuditEventWrite {
  return createAuditEventForActor(context, { kind: "user", id: actorUserId, label: null }, input);
}

export function createAuditEventForActor(
  context: RequestContext,
  actorInput: Readonly<
    | { kind: "user"; id: string; label: null }
    | { kind: "system"; id: string; label: string | null }
  >,
  input: AuditEventInput,
): AuditEventWrite {
  const actorId = required(inputValue(actorInput.id), "Audit actor id");
  const actorLabel = actorInput.kind === "system" && actorInput.label !== null
    ? boundedLabel(actorInput.label, "Audit actor label")
    : null;
  const subjectId = required(inputValue(input.subjectId), "Audit subject id");
  const subjectLabel = input.subjectLabel == null
    ? null
    : boundedLabel(input.subjectLabel, "Audit subject label");
  const payload = auditPayloadV2Schema.parse({
    schema_version: 2,
    changes: input.changes ?? [],
    context: input.context ?? [],
  });
  assertDisplaySafeAuditPayload(payload);
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_AUDIT_PAYLOAD_BYTES) {
    throw validation("Audit payload is too large");
  }

  return Object.freeze({
    eventId: crypto.randomUUID(),
    requestId: context.requestId,
    actorKind: actorInput.kind,
    actorId,
    actorLabel,
    subjectType: input.subjectType,
    subjectId,
    subjectLabel,
    action: input.action,
    payload,
    occurredAt: context.now,
  });
}

function assertDisplaySafeAuditPayload(payload: AuditPayloadV2): void {
  assertUniqueFields(payload.changes.map(({ field }) => field), "Audit changes");
  assertUniqueFields(payload.context.map(({ field }) => field), "Audit context");
  for (const change of payload.changes) {
    assertRuntimeAuditField(change.field);
    assertDisplaySafeAuditValue(change.field, change.before);
    assertDisplaySafeAuditValue(change.field, change.after);
  }
  for (const entry of payload.context) {
    assertRuntimeAuditField(entry.field);
    assertDisplaySafeAuditValue(entry.field, entry.value);
  }
}

function assertRuntimeAuditField(field: AuditField): void {
  if (RUNTIME_RESTRICTED_FIELDS.has(field)) {
    throw validation(`Audit field ${field} cannot be written by runtime business operations`);
  }
}

function assertUniqueFields(fields: readonly AuditField[], label: string): void {
  if (new Set(fields).size !== fields.length) throw validation(`${label} contains duplicate fields`);
}

function assertDisplaySafeAuditValue(field: AuditField, value: AuditValue): void {
  if (value.type === "code") {
    assertDisplaySafeAuditCode(field, value.value);
  }
  if (value.type === "reference" && !TECHNICAL_REFERENCE_FIELDS.has(field)) {
    if (!value.value.label?.trim()) throw validation(`Audit reference ${field} requires a display label`);
  }
  if (value.type === "list") {
    for (const item of value.value) assertDisplaySafeAuditValue(field, item);
  }
}

function assertDisplaySafeAuditCode(field: AuditField, value: string): void {
  const normalized = value.trim();
  if (/^[\[{]/.test(normalized)) {
    throw validation("Audit code values must be controlled identifiers, not serialized data");
  }
  if (FREEFORM_CODE_FIELDS.has(field)) return;
  if (PERMISSION_FIELDS.has(field) && PERMISSION_SET.has(normalized)) return;
  if (field === "changed_sections"
    && (AUDIT_SECTION_SET.has(normalized)
      || (AUDIT_FIELD_SET.has(normalized) && !RUNTIME_RESTRICTED_FIELDS.has(normalized as AuditField)))) return;
  if (field === "subject_type" && AUDIT_ENTITY_TYPE_SET.has(normalized)) return;
  if (!AUDIT_CODE_VALUE_SET.has(normalized)) {
    throw validation(`Audit code ${field} has no controlled display value`);
  }
}

export class AuditService {
  constructor(private readonly store: AuditStore) {}

  async list(context: RequestContext, query: AuditQuery): Promise<CursorResponse<AuditEvent>> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_VIEW);
    assertAuditQuery(query);
    const page = await this.store.list({
      ...query,
      cursor: query.cursor ? decodeAuditCursor(query.cursor) : null,
    });
    const last = page.data.at(-1);
    return {
      data: page.data,
      next_cursor: page.hasMore && last
        ? encodeAuditCursor({ occurredAt: last.occurred_at, eventId: last.event_id })
        : null,
    };
  }

  export(context: RequestContext, query: AuditFilter): AsyncIterable<AuditEvent> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    assertAuditFilter(query);
    return this.store.export(query);
  }

  recordExport(
    context: RequestContext,
    format: "csv" | "json",
    query: AuditFilter,
  ): Promise<void> {
    context.authorization.require(PERMISSION_ID.ADMIN_AUDIT_EXPORT);
    assertAuditFilter(query);
    const auditContext: AuditContext[] = [
      { field: "format", value: { type: "code", value: format } },
      ...optionalContext("subject_type", "code", query.subjectType),
      ...optionalContext("subject_id", "reference", query.subjectId),
      ...optionalContext("actor_id", "reference", query.actorId),
      ...optionalContext("search", "text", query.search),
      ...optionalContext("start_at", "datetime", query.startAt),
      ...optionalContext("end_at", "datetime", query.endAt),
    ];
    return this.store.recordExport(createAuditEvent(context, {
      subjectType: "audit_log_export",
      subjectId: context.requestId,
      subjectLabel: null,
      action: format === "csv" ? "export_filtered_csv" : "export_filtered_json",
      context: auditContext,
    }));
  }
}

function optionalContext(
  field: AuditContext["field"],
  type: "code" | "datetime" | "reference" | "text",
  value: string | undefined,
): AuditContext[] {
  if (value === undefined) return [];
  return [{
    field,
    value: type === "reference"
      ? { type, value: { id: value, label: null } }
      : { type, value },
  } as AuditContext];
}

function inputValue(value: string): string {
  return value.trim();
}

function required(value: string, field: string): string {
  if (!value) throw validation(`${field} is required`);
  return value;
}

function boundedLabel(value: string, field: string): string {
  const label = required(value.trim(), field);
  if (label.length > MAX_AUDIT_LABEL_LENGTH) throw validation(`${field} is too long`);
  return label;
}

function assertAuditQuery(query: AuditQuery): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw validation("Invalid audit pagination");
  }
  if (query.cursor !== undefined && (query.cursor.length < 1 || query.cursor.length > 512)) {
    throw invalidCursor();
  }
  assertAuditFilter(query);
}

function assertAuditFilter(query: AuditFilter): void {
  assertPortableLikeSearch(query.search?.toLowerCase(), "Audit search");
  if (query.subjectId !== undefined && query.subjectType === undefined) {
    throw validation("Audit subject type is required with a subject id");
  }
  if (query.startAt && query.endAt && query.startAt > query.endAt) {
    throw validation("Audit date range is invalid");
  }
}

function encodeAuditCursor(cursor: AuditCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ occurred_at: cursor.occurredAt, event_id: cursor.eventId }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeAuditCursor(value: string): AuditCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error();
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )) as Record<string, unknown>;
    if (typeof parsed.occurred_at !== "string" || Number.isNaN(Date.parse(parsed.occurred_at))
      || typeof parsed.event_id !== "string" || parsed.event_id.length < 1 || parsed.event_id.length > 128) throw new Error();
    return { occurredAt: parsed.occurred_at, eventId: parsed.event_id };
  } catch {
    throw invalidCursor();
  }
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function invalidCursor(): AppError {
  return validation("Invalid audit cursor");
}
