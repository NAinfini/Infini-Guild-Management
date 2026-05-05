import { auditLogSchema } from "@guild/shared";
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { auditLog } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern } from "./helpers";
import { parsePage } from "../routes/_shared";

type DrizzleDb = ReturnType<typeof drizzle>;

type AuditArchiveManifestFile = {
  key: string;
  row_count: number;
  size_bytes: number;
  content_encoding?: string;
  content_type?: string;
};

type AuditArchiveManifest = {
  month: string;
  generated_at: string;
  total_rows: number;
  entities: Record<string, number>;
  files: AuditArchiveManifestFile[];
};

type SignedArchiveDownloadPayload = {
  key: string;
  month: string;
  actor_id: string;
  exp: number;
  nonce: string;
};

export type MediaLike = {
  get: (key: string) => Promise<{ text: () => Promise<string>; body: ReadableStream | null; httpMetadata?: { contentType?: string; contentEncoding?: string }; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  put: (key: string, value: string | ReadableStream, options?: { httpMetadata?: { contentType?: string; contentEncoding?: string } }) => Promise<void>;
  head: (key: string) => Promise<unknown>;
  list: (options: { prefix: string; cursor?: string; limit?: number }) => Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor: string }>;
};

const AUDIT_ARCHIVE_PREFIX = "audit-archive";
const AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS = 15 * 60;
const AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS = 60;

const AUDIT_LOG_DEFAULT_RANGE_DAYS = 90;
const AUDIT_LOG_MAX_RANGE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

type AuditLogRow = {
  id: string;
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle: string | null;
  detailText: string | null;
  createdAt: string;
};

type AuditLogQueryInput = {
  page?: string;
  limit?: string;
  entity_type?: string;
  actor_id?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
  format?: string;
};

type ResolvedAuditLogQuery = {
  page: number;
  limit: number;
  offset: number;
  entityType: string;
  actorId: string;
  search: string;
  startAt: string;
  endAt: string;
  format: "csv" | "json";
};

type AuditLogInput = {
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
};

type AdminAuditServiceDeps = {
  db: DrizzleDb;
  media: MediaLike;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  generateId: () => string;
  signingSecret: string;
  now?: () => Date;
};

export class AuditLogQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLogQueryError";
  }
}

function parseIsoDateTime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildAuditLogWhere(query: ResolvedAuditLogQuery): SQL<unknown> {
  const filters: SQL<unknown>[] = [];

  if (query.entityType) {
    filters.push(eq(auditLog.entityType, query.entityType));
  }
  if (query.actorId) {
    filters.push(eq(auditLog.actorId, query.actorId));
  }
  if (query.search) {
    const pattern = `%${escapeLikePattern(query.search)}%`;
    filters.push(
      or(
        like(auditLog.action, pattern),
        like(auditLog.entityId, pattern),
        like(auditLog.diffTitle, pattern),
        like(auditLog.detailText, pattern),
      )!,
    );
  }

  filters.push(gte(auditLog.createdAt, query.startAt));
  filters.push(lte(auditLog.createdAt, query.endAt));

  return and(...filters)!;
}

function serializeAuditLogRow(row: AuditLogRow) {
  return auditLogSchema.parse({
    id: row.id,
    entity_type: row.entityType,
    action: row.action,
    actor_id: row.actorId,
    entity_id: row.entityId,
    diff_title: row.diffTitle,
    detail_text: row.detailText,
    created_at: row.createdAt,
  });
}

function csvCell(value: string | null) {
  const normalized = value ?? "";
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function archiveMonthPaths(month: string): { manifestKey: string } {
  const [year, monthNumber] = month.split("-");
  return { manifestKey: `${AUDIT_ARCHIVE_PREFIX}/${year}/${monthNumber}/manifest.json` };
}

function normalizeAuditArchiveManifest(value: unknown, month: string): AuditArchiveManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const payloadMonth = typeof record.month === "string" ? record.month : null;
  const generatedAt = typeof record.generated_at === "string" ? record.generated_at : null;
  const totalRows = typeof record.total_rows === "number" ? record.total_rows : null;
  const filesRaw = record.files;
  if (payloadMonth !== month || !generatedAt || totalRows === null || !Array.isArray(filesRaw)) return null;
  const files: AuditArchiveManifestFile[] = [];
  for (const f of filesRaw) {
    if (!f || typeof f !== "object") return null;
    const fr = f as Record<string, unknown>;
    const key = typeof fr.key === "string" ? fr.key : null;
    const rowCount = typeof fr.row_count === "number" ? fr.row_count : null;
    const sizeBytes = typeof fr.size_bytes === "number" ? fr.size_bytes : null;
    if (!key || rowCount === null || sizeBytes === null) return null;
    files.push({
      key, row_count: rowCount, size_bytes: sizeBytes,
      content_encoding: typeof fr.content_encoding === "string" ? fr.content_encoding : undefined,
      content_type: typeof fr.content_type === "string" ? fr.content_type : undefined,
    });
  }
  const entities: Record<string, number> = {};
  const entitiesRaw = record.entities;
  if (entitiesRaw && typeof entitiesRaw === "object" && !Array.isArray(entitiesRaw)) {
    for (const [et, count] of Object.entries(entitiesRaw)) {
      if (typeof count === "number") entities[et] = count;
    }
  }
  return { month: payloadMonth, generated_at: generatedAt, total_rows: totalRows, entities, files };
}

async function listArchiveMonthsFromR2(media: MediaLike): Promise<string[]> {
  const months = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await media.list({ prefix: `${AUDIT_ARCHIVE_PREFIX}/`, cursor, limit: 1000 });
    for (const object of page.objects) {
      const m = /^audit-archive\/(\d{4})\/(\d{2})\/manifest\.json$/.exec(object.key);
      if (m?.[1] && m?.[2]) months.add(`${m[1]}-${m[2]}`);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return Array.from(months).sort((a, b) => b.localeCompare(a));
}

async function readArchiveManifestFromR2(media: MediaLike, month: string): Promise<AuditArchiveManifest | null> {
  const { manifestKey } = archiveMonthPaths(month);
  const obj = await media.get(manifestKey);
  if (!obj) return null;
  const parsed = normalizeAuditArchiveManifest(JSON.parse(await obj.text()) as unknown, month);
  if (!parsed) throw new Error("Invalid archive manifest");
  return parsed;
}

async function readArchiveFilesForDownload(media: MediaLike, month: string): Promise<AuditArchiveManifestFile[] | null> {
  const manifest = await readArchiveManifestFromR2(media, month);
  return manifest ? manifest.files : null;
}

function utf8Encode(value: string): Uint8Array { return new TextEncoder().encode(value); }
function toArrayBuffer(value: Uint8Array): ArrayBuffer { const c = new Uint8Array(value.byteLength); c.set(value); return c.buffer; }
function utf8ArrayBuffer(value: string): ArrayBuffer { return toArrayBuffer(utf8Encode(value)); }
function utf8Decode(value: Uint8Array): string { return new TextDecoder().decode(value); }

function base64UrlEncode(value: Uint8Array): string {
  const raw = String.fromCharCode(...value);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function createHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", utf8ArrayBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signArchiveDownloadToken(secret: string, payload: SignedArchiveDownloadPayload): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(utf8Encode(payloadJson));
  const key = await createHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, utf8ArrayBuffer(payloadEncoded));
  return `${payloadEncoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyArchiveDownloadToken(secret: string, token: string): Promise<SignedArchiveDownloadPayload | null> {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;
  const key = await createHmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(base64UrlDecode(signaturePart)), utf8ArrayBuffer(payloadPart));
  if (!valid) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(utf8Decode(base64UrlDecode(payloadPart))) as unknown; } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const keyVal = typeof p.key === "string" ? p.key : null;
  const month = typeof p.month === "string" ? p.month : null;
  const actorId = typeof p.actor_id === "string" ? p.actor_id : null;
  const exp = typeof p.exp === "number" ? p.exp : null;
  const nonce = typeof p.nonce === "string" ? p.nonce : null;
  if (!keyVal || !month || !actorId || exp === null || !nonce) return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  return { key: keyVal, month, actor_id: actorId, exp, nonce };
}

export class AdminAuditService {
  private readonly deps: AdminAuditServiceDeps;

  constructor(deps: AdminAuditServiceDeps) {
    this.deps = deps;
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  resolveAuditLogQuery(input: AuditLogQueryInput): ResolvedAuditLogQuery {
    const page = parsePage(input.page, 1);
    const limit = Math.min(50, parsePage(input.limit, 50));
    const entityType = (input.entity_type ?? "").trim();
    const actorId = (input.actor_id ?? "").trim();
    const search = (input.search ?? "").trim();
    const format = (input.format ?? "csv").trim().toLowerCase();
    if (format !== "csv" && format !== "json") {
      throw new AuditLogQueryError("format must be csv or json");
    }

    const startAtQuery = (input.start_at ?? "").trim();
    const endAtQuery = (input.end_at ?? "").trim();
    let startAt: string;
    let endAt: string;

    if (!startAtQuery && !endAtQuery) {
      const now = this.now();
      endAt = now.toISOString();
      startAt = new Date(now.getTime() - AUDIT_LOG_DEFAULT_RANGE_DAYS * DAY_MS).toISOString();
    } else if (startAtQuery && endAtQuery) {
      const parsedStartAt = parseIsoDateTime(startAtQuery);
      const parsedEndAt = parseIsoDateTime(endAtQuery);
      if (!parsedStartAt || !parsedEndAt) {
        throw new AuditLogQueryError("start_at and end_at must be valid ISO datetime");
      }
      if (parsedStartAt > parsedEndAt) {
        throw new AuditLogQueryError("start_at must be earlier than end_at");
      }
      if (new Date(parsedEndAt).getTime() - new Date(parsedStartAt).getTime() > AUDIT_LOG_MAX_RANGE_DAYS * DAY_MS) {
        throw new AuditLogQueryError(`Date range must be within ${AUDIT_LOG_MAX_RANGE_DAYS} days`);
      }
      startAt = parsedStartAt;
      endAt = parsedEndAt;
    } else {
      throw new AuditLogQueryError("start_at and end_at must be provided together");
    }

    return {
      page,
      limit,
      offset: (page - 1) * limit,
      entityType,
      actorId,
      search,
      startAt,
      endAt,
      format,
    };
  }

  async listAuditLogs(input: AuditLogQueryInput) {
    const query = this.resolveAuditLogQuery(input);
    const where = buildAuditLogWhere(query);
    const rows = await this.deps.db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        action: auditLog.action,
        actorId: auditLog.actorId,
        entityId: auditLog.entityId,
        diffTitle: auditLog.diffTitle,
        detailText: auditLog.detailText,
        createdAt: auditLog.createdAt,
        _total: sql<number>`count(*) over()`,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const total = Number((rows[0] as Record<string, unknown> | undefined)?._total ?? 0);

    return {
      data: rows.map(serializeAuditLogRow),
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.max(1, Math.ceil(total / query.limit)),
      start_at: query.startAt,
      end_at: query.endAt,
    };
  }

  async exportAuditLogs(actorId: string, input: AuditLogQueryInput) {
    const query = this.resolveAuditLogQuery(input);
    const where = buildAuditLogWhere(query);
    const rows = await this.deps.db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        action: auditLog.action,
        actorId: auditLog.actorId,
        entityId: auditLog.entityId,
        diffTitle: auditLog.diffTitle,
        detailText: auditLog.detailText,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt));
    const serializedRows = rows.map(serializeAuditLogRow);
    const rangeStartLabel = query.startAt.slice(0, 10);
    const rangeEndLabel = query.endAt.slice(0, 10);
    const filenameBase = `guild-audit-${rangeStartLabel}-to-${rangeEndLabel}`;

    await this.deps.writeAuditLog({
      entityType: "audit_log_export",
      action: query.format === "csv" ? "export_filtered_csv" : "export_filtered_json",
      actorId,
      entityId: "audit-log",
      diffTitle: `${rangeStartLabel} ~ ${rangeEndLabel}`,
      detailText: JSON.stringify({
        format: query.format,
        start_at: query.startAt,
        end_at: query.endAt,
        total: serializedRows.length,
        filters: {
          entity_type: query.entityType || null,
          actor_id: query.actorId || null,
          search: query.search || null,
        },
      }),
    });

    if (query.format === "json") {
      return {
        filename: `${filenameBase}.json`,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          exported_at: this.now().toISOString(),
          start_at: query.startAt,
          end_at: query.endAt,
          total: serializedRows.length,
          data: serializedRows,
        }, null, 2),
      };
    }

    const header = ["id", "entity_type", "action", "actor_id", "entity_id", "diff_title", "detail_text", "created_at"].join(",");
    const lines = serializedRows.map((row) =>
      [csvCell(row.id), csvCell(row.entity_type), csvCell(row.action), csvCell(row.actor_id), csvCell(row.entity_id), csvCell(row.diff_title), csvCell(row.detail_text), csvCell(row.created_at)].join(","),
    );

    return {
      filename: `${filenameBase}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: [header, ...lines].join("\n"),
    };
  }

  async listArchiveMonths(): Promise<ServiceResult<{ months: string[]; source: string }>> {
    const months = await listArchiveMonthsFromR2(this.deps.media);
    return ok({ months, source: "r2_manifest" });
  }

  async getArchiveDownloadLinks(actorId: string, month: string, buildDownloadUrl: (token: string) => string): Promise<ServiceResult<unknown>> {
    if (!/^\d{4}-\d{2}$/.test(month)) return err("VALIDATION_ERROR", "month must match YYYY-MM");
    const cutoff = new Date(Date.now() - AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS * 1000).toISOString();
    const recent = (await this.deps.db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.entityType, "audit_archive_export"), eq(auditLog.actorId, actorId), gte(auditLog.createdAt, cutoff))).limit(1))[0];
    if (recent) return err("RATE_LIMITED", `Archive export is limited to one action every ${AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS} seconds`);
    let files: AuditArchiveManifestFile[] | null;
    try {
      files = await readArchiveFilesForDownload(this.deps.media, month);
    } catch {
      return err("SERVER_ERROR", "Failed to read archive manifest");
    }
    if (!files || files.length === 0) return err("NOT_FOUND", "Archive month not found");
    if (!this.deps.signingSecret) return err("SERVER_ERROR", "Archive signing is not configured");
    const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS;
    const downloadFiles = await Promise.all(files.map(async (file) => {
      const token = await signArchiveDownloadToken(this.deps.signingSecret, { key: file.key, month, actor_id: actorId, exp: expiresAtEpochSeconds, nonce: this.deps.generateId().slice(0, 10) });
      return { key: file.key, row_count: file.row_count, size_bytes: file.size_bytes, expires_at: new Date(expiresAtEpochSeconds * 1000).toISOString(), url: buildDownloadUrl(token) };
    }));
    await this.deps.writeAuditLog({ entityType: "audit_archive_export", action: "download_raw_ndjson_gz", actorId, entityId: month, diffTitle: month, detailText: JSON.stringify({ file_count: downloadFiles.length, ttl_seconds: AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS }) });
    return ok({ month, expires_in_seconds: AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS, files: downloadFiles });
  }

  async verifyAndGetArchiveFile(token: string): Promise<ServiceResult<{ body: ReadableStream; contentType: string; contentEncoding?: string; filename: string; actorId: string; month: string; key: string }>> {
    if (!token) return err("VALIDATION_ERROR", "token is required");
    if (!this.deps.signingSecret) return err("SERVER_ERROR", "Archive signing is not configured");
    const payload = await verifyArchiveDownloadToken(this.deps.signingSecret, token);
    if (!payload) return err("UNAUTHORIZED", "Invalid or expired download token");
    if (!payload.key.startsWith(`${AUDIT_ARCHIVE_PREFIX}/`)) return err("FORBIDDEN", "Invalid archive object key");
    const object = await this.deps.media.get(payload.key);
    if (!object || !object.body) return err("NOT_FOUND", "Archive file not found");
    await this.deps.writeAuditLog({ entityType: "audit_archive_export", action: "download_raw_ndjson_gz", actorId: payload.actor_id, entityId: payload.month, diffTitle: payload.month, detailText: JSON.stringify({ key: payload.key }) });
    return ok({ body: object.body, contentType: object.httpMetadata?.contentType ?? "application/octet-stream", contentEncoding: object.httpMetadata?.contentEncoding, filename: payload.key.split("/").at(-1) ?? "archive.bin", actorId: payload.actor_id, month: payload.month, key: payload.key });
  }
}
