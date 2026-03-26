import {
  PERMISSIONS,
  ROLES,
  adminRoleSchema,
  auditLogSchema,
  botSettingsSchema,
  inviteLinkSchema,
  inviteLinkStatsSchema,
  type Permission,
  type Role,
} from "@guild/shared";
import { and, desc, eq, gt, gte, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { auditLog, inviteLinks, memberProfiles, rolePermissions, roles, sessions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

type DrizzleDb = ReturnType<typeof drizzle>;

// --- Types moved from admin.ts routes ---

export type BotSettings = {
  discord: {
    guild_id: string;
    notification_channel_id: string;
    team_comp_channel_id: string;
    default_toggles: Record<string, boolean>;
  };
  wechat: {
    room_ids: string[];
    default_toggles: Record<string, boolean>;
  };
};

export type AuditArchiveRow = {
  id: string;
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle: string | null;
  detailText: string | null;
  createdAt: string;
};

export type AuditArchiveManifestFile = {
  key: string;
  row_count: number;
  size_bytes: number;
  content_encoding?: string;
  content_type?: string;
};

export type AuditArchiveManifest = {
  month: string;
  generated_at: string;
  total_rows: number;
  entities: Record<string, number>;
  files: AuditArchiveManifestFile[];
};

export type AuditArchiveReadResult = {
  rows: AuditArchiveRow[];
  source: "r2_manifest";
  manifest: AuditArchiveManifest | null;
};

type SignedArchiveDownloadPayload = {
  key: string;
  month: string;
  actor_id: string;
  exp: number;
  nonce: string;
};

export type AnalyticsSettings = {
  reference_duration_minutes: number;
  modifier_weight_kda: number;
  modifier_weight_towers: number;
  modifier_weight_credits: number;
  modifier_weight_distance: number;
  modifier_weight_basehp: number;
};

export type MediaLike = {
  get: (key: string) => Promise<{ text: () => Promise<string>; body: ReadableStream | null; httpMetadata?: { contentType?: string; contentEncoding?: string }; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  put: (key: string, value: string | ReadableStream, options?: { httpMetadata?: { contentType?: string; contentEncoding?: string } }) => Promise<void>;
  head: (key: string) => Promise<unknown>;
  list: (options: { prefix: string; cursor?: string; limit?: number }) => Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor: string }>;
};

// --- Constants ---

export const BOT_SETTINGS_KEY = "config/bot-settings.json";
const AUDIT_ARCHIVE_PREFIX = "audit-archive";
const AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS = 15 * 60;
const AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS = 60;
const D1_SAFE_VARIABLE_LIMIT = 90;
const ROLE_PERMISSION_INSERT_BATCH_SIZE = Math.max(1, Math.floor(D1_SAFE_VARIABLE_LIMIT / 3));
const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";

const BUILTIN_ROLE_DEFAULTS: Record<Role, { name: string; level: number; color: string }> = {
  admin: { name: "Admin", level: 3, color: "red" },
  moderator: { name: "Moderator", level: 2, color: "blue" },
  member: { name: "Member", level: 1, color: "gray" },
};

const MODERATOR_DEFAULT_PERMISSIONS = new Set<Permission>([
  "admin.users.view", "admin.users.edit", "admin.invite.view", "admin.audit.view",
  "admin.bot.view", "admin.status.view", "admin.analytics.view", "admin.roles.view",
  "guildwar.manage", "guildwar.history.edit",
  "events.manage", "announcements.manage", "gallery.upload", "gallery.manage", "wiki.edit",
]);
const MEMBER_DEFAULT_PERMISSIONS = new Set<Permission>(["gallery.upload"]);

// --- Permission helpers (exported for route use) ---

export function defaultPermissionGranted(roleId: string, permission: Permission): boolean {
  if (roleId === "admin") return true;
  if (roleId === "moderator") return MODERATOR_DEFAULT_PERMISSIONS.has(permission);
  if (roleId === "member") return MEMBER_DEFAULT_PERMISSIONS.has(permission);
  return false;
}

export function emptyPermissionRecord(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, false])) as Record<Permission, boolean>;
}

export function fullAdminPermissionRecord(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, true])) as Record<Permission, boolean>;
}

export function parsePermissionRecord(
  roleId: string,
  permissionRows: Array<{ permission: string; granted: boolean }>,
): Record<Permission, boolean> {
  const record = roleId === "admin" ? fullAdminPermissionRecord() : emptyPermissionRecord();
  for (const row of permissionRows) {
    const perm = row.permission as Permission;
    if (!PERMISSIONS.includes(perm)) continue;
    record[perm] = roleId === "admin" ? true : row.granted;
  }
  return record;
}

export async function insertRolePermissionRows(
  db: DrizzleDb,
  rows: Array<{ roleId: string; permission: string; granted: boolean }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += ROLE_PERMISSION_INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + ROLE_PERMISSION_INSERT_BATCH_SIZE);
    await db.insert(rolePermissions).values(chunk);
  }
}

export async function replaceRolePermissions(
  db: DrizzleDb,
  roleId: string,
  permissionRecord: Record<Permission, boolean>,
): Promise<void> {
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await insertRolePermissionRows(
    db,
    PERMISSIONS.map((p) => ({ roleId, permission: p, granted: permissionRecord[p] })),
  );
}

export async function ensureBuiltinRolesAndPermissions(db: DrizzleDb): Promise<void> {
  const existingRoleRows = await db
    .select({ id: roles.id }).from(roles).where(inArray(roles.id, [...ROLES]));
  const existingRoleSet = new Set(existingRoleRows.map((r) => r.id));

  for (const roleId of ROLES) {
    if (existingRoleSet.has(roleId)) continue;
    const defaults = BUILTIN_ROLE_DEFAULTS[roleId];
    await db.insert(roles).values({ id: roleId, name: defaults.name, level: defaults.level, color: defaults.color, isBuiltin: true });
  }

  const permissionRows = await db
    .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions).where(inArray(rolePermissions.roleId, [...ROLES]));
  const existingPermSet = new Set(permissionRows.map((r) => `${r.roleId}:${r.permission}`));
  const missingRows: Array<{ roleId: string; permission: string; granted: boolean }> = [];
  for (const roleId of ROLES) {
    for (const perm of PERMISSIONS) {
      if (!existingPermSet.has(`${roleId}:${perm}`)) {
        missingRows.push({ roleId, permission: perm, granted: defaultPermissionGranted(roleId, perm) });
      }
    }
  }
  if (missingRows.length > 0) {
    await insertRolePermissionRows(db, missingRows);
  }
}

// --- Bot settings helpers ---

export function defaultBotSettings(): BotSettings {
  return {
    discord: { guild_id: "", notification_channel_id: "", team_comp_channel_id: "", default_toggles: {} },
    wechat: { room_ids: [], default_toggles: {} },
  };
}

export async function readBotSettingsFromMedia(media: MediaLike): Promise<BotSettings> {
  const object = await media.get(BOT_SETTINGS_KEY);
  if (!object) return defaultBotSettings();
  try {
    return botSettingsSchema.parse(JSON.parse(await object.text()) as unknown);
  } catch {
    return defaultBotSettings();
  }
}

// --- Analytics settings helpers ---

export function defaultAnalyticsSettings(): AnalyticsSettings {
  return {
    reference_duration_minutes: 30,
    modifier_weight_kda: 0.30,
    modifier_weight_towers: 0.10,
    modifier_weight_credits: 0.30,
    modifier_weight_distance: 0.15,
    modifier_weight_basehp: 0.15,
  };
}

export function normalizeAnalyticsWeights(settings: AnalyticsSettings): AnalyticsSettings {
  const weightSum = settings.modifier_weight_kda + settings.modifier_weight_towers +
    settings.modifier_weight_credits + settings.modifier_weight_distance + settings.modifier_weight_basehp;
  if (weightSum <= 0) return settings;
  return {
    ...settings,
    modifier_weight_kda: Number((settings.modifier_weight_kda / weightSum).toFixed(4)),
    modifier_weight_towers: Number((settings.modifier_weight_towers / weightSum).toFixed(4)),
    modifier_weight_credits: Number((settings.modifier_weight_credits / weightSum).toFixed(4)),
    modifier_weight_distance: Number((settings.modifier_weight_distance / weightSum).toFixed(4)),
    modifier_weight_basehp: Number((settings.modifier_weight_basehp / weightSum).toFixed(4)),
  };
}

export function parseAnalyticsInput(record: Record<string, unknown>): AnalyticsSettings {
  const defaults = defaultAnalyticsSettings();
  return {
    reference_duration_minutes:
      typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0
        ? record.reference_duration_minutes : defaults.reference_duration_minutes,
    modifier_weight_kda: typeof record.modifier_weight_kda === "number" ? record.modifier_weight_kda : defaults.modifier_weight_kda,
    modifier_weight_towers: typeof record.modifier_weight_towers === "number" ? record.modifier_weight_towers : defaults.modifier_weight_towers,
    modifier_weight_credits: typeof record.modifier_weight_credits === "number" ? record.modifier_weight_credits : defaults.modifier_weight_credits,
    modifier_weight_distance: typeof record.modifier_weight_distance === "number" ? record.modifier_weight_distance : defaults.modifier_weight_distance,
    modifier_weight_basehp: typeof record.modifier_weight_basehp === "number" ? record.modifier_weight_basehp : defaults.modifier_weight_basehp,
  };
}

// --- Audit archive helpers ---

export function normalizeAuditArchiveRow(value: unknown): AuditArchiveRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : null;
  const entityType = typeof row.entityType === "string" ? row.entityType : typeof row.entity_type === "string" ? row.entity_type : null;
  const action = typeof row.action === "string" ? row.action : null;
  const actorId = typeof row.actorId === "string" ? row.actorId : typeof row.actor_id === "string" ? row.actor_id : null;
  const entityId = typeof row.entityId === "string" ? row.entityId : typeof row.entity_id === "string" ? row.entity_id : null;
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : typeof row.created_at === "string" ? row.created_at : null;
  if (!id || !entityType || !action || !actorId || !entityId || !createdAt) return null;
  return {
    id, entityType, action, actorId, entityId,
    diffTitle: typeof row.diffTitle === "string" ? row.diffTitle : typeof row.diff_title === "string" ? row.diff_title : null,
    detailText: typeof row.detailText === "string" ? row.detailText : typeof row.detail_text === "string" ? row.detail_text : null,
    createdAt,
  };
}

export function archiveMonthPaths(month: string): { manifestKey: string } {
  const [year, monthNumber] = month.split("-");
  return { manifestKey: `${AUDIT_ARCHIVE_PREFIX}/${year}/${monthNumber}/manifest.json` };
}

function normalizeArchiveManifestFile(value: unknown): AuditArchiveManifestFile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const key = typeof row.key === "string" ? row.key : null;
  const rowCount = typeof row.row_count === "number" ? row.row_count : null;
  const sizeBytes = typeof row.size_bytes === "number" ? row.size_bytes : null;
  if (!key || rowCount === null || sizeBytes === null) return null;
  return {
    key, row_count: rowCount, size_bytes: sizeBytes,
    content_encoding: typeof row.content_encoding === "string" ? row.content_encoding : undefined,
    content_type: typeof row.content_type === "string" ? row.content_type : undefined,
  };
}

export function normalizeAuditArchiveManifest(value: unknown, month: string): AuditArchiveManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const payloadMonth = typeof record.month === "string" ? record.month : null;
  const generatedAt = typeof record.generated_at === "string" ? record.generated_at : null;
  const totalRows = typeof record.total_rows === "number" ? record.total_rows : null;
  const filesRaw = record.files;
  if (payloadMonth !== month || !generatedAt || totalRows === null || !Array.isArray(filesRaw)) return null;
  const files = filesRaw.map(normalizeArchiveManifestFile);
  if (files.some((f) => f === null)) return null;
  const entities: Record<string, number> = {};
  const entitiesRaw = record.entities;
  if (entitiesRaw && typeof entitiesRaw === "object" && !Array.isArray(entitiesRaw)) {
    for (const [et, count] of Object.entries(entitiesRaw)) {
      if (typeof count === "number") entities[et] = count;
    }
  }
  return { month: payloadMonth, generated_at: generatedAt, total_rows: totalRows, entities, files: files as AuditArchiveManifestFile[] };
}

export async function decompressGzipText(buffer: ArrayBuffer): Promise<string> {
  const decompression = new DecompressionStream("gzip");
  const decompressedStream = new Blob([buffer]).stream().pipeThrough(decompression);
  return await new Response(decompressedStream).text();
}

export function parseArchiveRowsFromNdjson(ndjson: string): AuditArchiveRow[] {
  if (!ndjson.trim()) return [];
  const lines = ndjson.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const normalized = lines.map((l) => normalizeAuditArchiveRow(JSON.parse(l) as unknown));
  if (normalized.some((r) => r === null)) throw new Error("Invalid archive row shape");
  return normalized as AuditArchiveRow[];
}

export async function readArchiveRowsFromManifest(media: MediaLike, manifest: AuditArchiveManifest): Promise<AuditArchiveRow[]> {
  const rows: AuditArchiveRow[] = [];
  for (const file of manifest.files) {
    const object = await media.get(file.key);
    if (!object) throw new Error(`Missing archive file ${file.key}`);
    const shouldDecompress = file.key.endsWith(".gz") || file.content_encoding?.toLowerCase() === "gzip" || object.httpMetadata?.contentEncoding?.toLowerCase() === "gzip";
    const text = shouldDecompress ? await decompressGzipText(await object.arrayBuffer()) : await object.text();
    rows.push(...parseArchiveRowsFromNdjson(text));
  }
  return rows;
}

export async function listArchiveMonthsFromR2(media: MediaLike): Promise<string[]> {
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

export async function readArchiveMonthFromR2(media: MediaLike, month: string): Promise<AuditArchiveReadResult | null> {
  const { manifestKey } = archiveMonthPaths(month);
  const manifestObject = await media.get(manifestKey);
  if (!manifestObject) return null;
  const parsed = normalizeAuditArchiveManifest(JSON.parse(await manifestObject.text()) as unknown, month);
  if (!parsed) throw new Error("Invalid archive manifest");
  const rows = await readArchiveRowsFromManifest(media, parsed);
  return { rows, source: "r2_manifest", manifest: parsed };
}

export async function readArchiveManifestFromR2(media: MediaLike, month: string): Promise<AuditArchiveManifest | null> {
  const { manifestKey } = archiveMonthPaths(month);
  const obj = await media.get(manifestKey);
  if (!obj) return null;
  const parsed = normalizeAuditArchiveManifest(JSON.parse(await obj.text()) as unknown, month);
  if (!parsed) throw new Error("Invalid archive manifest");
  return parsed;
}

export async function readArchiveFilesForDownload(media: MediaLike, month: string): Promise<AuditArchiveManifestFile[] | null> {
  const manifest = await readArchiveManifestFromR2(media, month);
  return manifest ? manifest.files : null;
}

// --- HMAC signing helpers ---

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

export function archiveSigningSecret(secret: string | undefined): string {
  const s = secret?.trim();
  if (!s) throw new Error("BOT_SHARED_SECRET is not configured");
  return s;
}

export async function signArchiveDownloadToken(secret: string, payload: SignedArchiveDownloadPayload): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(utf8Encode(payloadJson));
  const key = await createHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, utf8ArrayBuffer(payloadEncoded));
  return `${payloadEncoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyArchiveDownloadToken(secret: string, token: string): Promise<SignedArchiveDownloadPayload | null> {
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

export const AUDIT_ARCHIVE_DOWNLOAD_FILE_PATH = "/api/admin/audit-archive/download/file";
export const ARCHIVE_DOWNLOAD_TTL_SECONDS = AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS;
export const ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS = AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS;
export const ARCHIVE_PREFIX = AUDIT_ARCHIVE_PREFIX;

// --- Audit Log ---

export const AUDIT_LOG_DEFAULT_RANGE_DAYS = 90;
export const AUDIT_LOG_MAX_RANGE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

type AuditLogInput = {
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
};

export type AuditLogRow = {
  id: string;
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle: string | null;
  detailText: string | null;
  createdAt: string;
};

export type AuditLogQueryInput = {
  page?: string;
  limit?: string;
  entity_type?: string;
  actor_id?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
  format?: string;
};

export type ResolvedAuditLogQuery = {
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

type AdminServiceDeps = {
  db: DrizzleDb;
  media: MediaLike;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  createBotTask: (input: {
    platform: string;
    taskType: string;
    targetId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    dispatchNow: boolean;
  }) => Promise<{ task_id: string }>;
  fetchDiscordChannels: (guildId: string) => Promise<Array<{ id: string; name: string; type: number }>>;
  generateId: () => string;
  generateInviteCode: () => string;
  generateTemporaryPassword: () => string;
  signingSecret: string;
  rawDb?: D1Database;
  ws?: unknown;
  now?: () => Date;
};

export class AuditLogQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLogQueryError";
  }
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export function parseIsoDateTime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildAuditLogWhere(query: ResolvedAuditLogQuery): SQL<unknown> {
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

export function serializeAuditLogRow(row: AuditLogRow) {
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

export class AdminService {
  private readonly deps: AdminServiceDeps;

  constructor(deps: AdminServiceDeps) {
    this.deps = deps;
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
    const totalRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where))[0];
    const total = Number(totalRow?.count ?? 0);
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
      .orderBy(desc(auditLog.createdAt))
      .limit(query.limit)
      .offset(query.offset);

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

  async listInviteLinks(includeExpired: boolean, includeRevoked: boolean): Promise<ServiceResult<unknown[]>> {
    const nowIso = this.now().toISOString();
    const filters: SQL<unknown>[] = [];
    if (!includeRevoked) filters.push(isNull(inviteLinks.revokedAt));
    if (!includeExpired) filters.push(or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, nowIso))!);
    const rows = await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, createdBy: inviteLinks.createdBy, maxUses: inviteLinks.maxUses, usedCount: inviteLinks.usedCount, expiresAt: inviteLinks.expiresAt, createdAt: inviteLinks.createdAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(and(...filters)).orderBy(desc(inviteLinks.createdAt));
    return ok(rows.map((r) => inviteLinkSchema.parse({ id: r.id, code: r.code, created_by: r.createdBy, max_uses: r.maxUses, used_count: r.usedCount, expires_at: r.expiresAt, created_at: r.createdAt, revoked_at: r.revokedAt })));
  }

  async getInviteLinkStats(): Promise<ServiceResult<{ total: number; active: number; revoked: number; expired: number; data: unknown[] }>> {
    const nowIso = this.now().toISOString();
    const rows = await this.deps.db.select({ id: inviteLinks.id, usedCount: inviteLinks.usedCount, maxUses: inviteLinks.maxUses, expiresAt: inviteLinks.expiresAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks);
    const stats = rows.map((r) => inviteLinkStatsSchema.parse({ id: r.id, used_count: r.usedCount, max_uses: r.maxUses, expires_at: r.expiresAt, revoked_at: r.revokedAt }));
    const revoked = stats.filter((s) => s.revoked_at !== null).length;
    const expired = stats.filter((s) => s.expires_at !== null && s.expires_at <= nowIso).length;
    const active = stats.filter((s) => s.revoked_at === null && (s.expires_at === null || s.expires_at > nowIso) && s.used_count < s.max_uses).length;
    return ok({ total: stats.length, active, revoked, expired, data: stats });
  }

  async createInviteLink(actorId: string, maxUses: number, expiresAt: string | null): Promise<ServiceResult<unknown>> {
    const inviteId = this.deps.generateId();
    const code = this.deps.generateInviteCode();
    await this.deps.db.insert(inviteLinks).values({ id: inviteId, code, createdBy: actorId, maxUses, usedCount: 0, expiresAt, revokedAt: null });
    const created = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, createdBy: inviteLinks.createdBy, maxUses: inviteLinks.maxUses, usedCount: inviteLinks.usedCount, expiresAt: inviteLinks.expiresAt, createdAt: inviteLinks.createdAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create invite link");
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "create", actorId, entityId: inviteId, diffTitle: code, detailText: JSON.stringify({ max_uses: maxUses, expires_at: expiresAt }) });
    return ok(inviteLinkSchema.parse({ id: created.id, code: created.code, created_by: created.createdBy, max_uses: created.maxUses, used_count: created.usedCount, expires_at: created.expiresAt, created_at: created.createdAt, revoked_at: created.revokedAt }));
  }

  async revokeInviteLink(actorId: string, inviteId: string): Promise<ServiceResult<void>> {
    const existing = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Invite link not found");
    if (existing.revokedAt !== null) return err("CONFLICT", "Invite link already revoked");
    await this.deps.db.update(inviteLinks).set({ revokedAt: this.now().toISOString() }).where(eq(inviteLinks.id, inviteId));
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "revoke", actorId, entityId: inviteId, diffTitle: existing.code });
    return ok(undefined);
  }

  async deleteInviteLink(actorId: string, inviteId: string): Promise<ServiceResult<void>> {
    const existing = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Invite link not found");
    await this.deps.db.delete(inviteLinks).where(eq(inviteLinks.id, inviteId));
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "delete", actorId, entityId: inviteId, diffTitle: existing.code });
    return ok(undefined);
  }

  async batchUpdateRole(actorId: string, userIds: string[], newRoleId: string): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    if (newRoleId === "admin") return err("FORBIDDEN", "Cannot assign builtin admin role via API");
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const roleExists = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, newRoleId)).limit(1))[0];
    if (!roleExists) return err("NOT_FOUND", "Role not found");
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ role: newRoleId, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_role_update", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds, new_role: newRoleId }) });
    return ok({ updated: existingUsers.length });
  }

  async batchDeactivate(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ isActive: false, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_deactivate", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds }) });
    return ok({ updated: existingUsers.length });
  }

  async batchReactivate(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ isActive: true, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_reactivate", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds }) });
    return ok({ updated: existingUsers.length });
  }

  async batchDelete(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      const now = this.now().toISOString();
      await this.deps.db.update(users).set({ isActive: false, deletedAt: now, updatedAt: now }).where(inArray(users.id, existingIds));
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_delete", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds }) });
    return ok({ updated: existingUsers.length });
  }

  async createMember(actorId: string, username: string): Promise<ServiceResult<{ user_id: string; username: string; temporary_password: string }>> {
    const existing = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.username, username)).limit(1))[0];
    if (existing && existing.deletedAt === null) return err("CONFLICT", "Username already taken");
    const userId = this.deps.generateId();
    const temporaryPassword = this.deps.generateTemporaryPassword();
    const passwordHash = await this.deps.createPasswordHash(temporaryPassword);
    const profileId = this.deps.generateId();
    const nowIso = this.now().toISOString();
    try {
      if (this.deps.rawDb) {
        await this.deps.rawDb.batch([
          this.deps.rawDb.prepare("INSERT INTO users (id, username, role, is_active, deleted_at, created_at, updated_at) VALUES (?1, ?2, 'member', 1, NULL, ?3, ?3)").bind(userId, username, nowIso),
          this.deps.rawDb.prepare("INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (?1, ?2, ?3)").bind(userId, passwordHash.passwordHash, passwordHash.salt),
          this.deps.rawDb.prepare("INSERT INTO member_profiles (id, user_id, power, classes, images, video_urls, discord_reminder_opt_out) VALUES (?1, ?2, 0, '[]', '[]', '[]', 0)").bind(profileId, userId),
        ]);
      } else {
        await this.deps.db.insert(users).values({ id: userId, username, role: "member", isActive: true, deletedAt: null });
        await this.deps.db.insert(userAuthPassword).values({ userId, passwordHash: passwordHash.passwordHash, salt: passwordHash.salt });
        await this.deps.db.insert(memberProfiles).values({ id: profileId, userId, power: 0, classes: "[]", images: "[]", videoUrls: "[]", discordReminderOptOut: false });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username")) return err("CONFLICT", "Username already taken");
      throw error;
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "admin_create_member", actorId, entityId: userId, detailText: JSON.stringify({ username }) });
    return ok({ user_id: userId, username, temporary_password: temporaryPassword });
  }

  async updateUserRole(actorId: string, targetUserId: string, newRoleId: string): Promise<ServiceResult<void>> {
    if (targetUserId === actorId) return err("CONFLICT", "You cannot change your own role");
    if (newRoleId === "admin") return err("FORBIDDEN", "Cannot assign builtin admin role via API");
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const roleExists = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, newRoleId)).limit(1))[0];
    if (!roleExists) return err("NOT_FOUND", "Role not found");
    const target = (await this.deps.db.select({ id: users.id, role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    await this.deps.db.update(users).set({ role: newRoleId, updatedAt: this.now().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user", action: "update_role", actorId, entityId: targetUserId, detailText: JSON.stringify({ from: target.role, to: newRoleId }) });
    return ok(undefined);
  }

  async deactivateUser(actorId: string, targetUserId: string, reason?: string): Promise<ServiceResult<void>> {
    if (targetUserId === actorId) return err("CONFLICT", "You cannot deactivate yourself");
    const target = (await this.deps.db.select({ id: users.id, isActive: users.isActive, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    if (!target.isActive) return err("CONFLICT", "User already deactivated");
    const nowIso = this.now().toISOString();
    if (this.deps.rawDb) {
      await this.deps.rawDb.batch([
        this.deps.rawDb.prepare("UPDATE users SET is_active = 0, updated_at = ?1 WHERE id = ?2").bind(nowIso, targetUserId),
        this.deps.rawDb.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(targetUserId),
      ]);
    } else {
      await this.deps.db.update(users).set({ isActive: false, updatedAt: nowIso }).where(eq(users.id, targetUserId));
      await this.deps.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "deactivate", actorId, entityId: targetUserId, detailText: JSON.stringify({ reason: reason ?? null }) });
    return ok(undefined);
  }

  async reactivateUser(actorId: string, targetUserId: string, reason?: string): Promise<ServiceResult<void>> {
    const target = (await this.deps.db.select({ id: users.id, isActive: users.isActive, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    if (target.isActive) return err("CONFLICT", "User is already active");
    await this.deps.db.update(users).set({ isActive: true, updatedAt: this.now().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user", action: "reactivate", actorId, entityId: targetUserId, detailText: JSON.stringify({ reason: reason ?? null }) });
    return ok(undefined);
  }

  async resetPassword(actorId: string, targetUserId: string, temporaryPasswordInput?: string): Promise<ServiceResult<{ temporary_password: string }>> {
    const temporaryPassword = temporaryPasswordInput ?? this.deps.generateTemporaryPassword();
    if (temporaryPassword.length < 8) return err("VALIDATION_ERROR", "temporary_password must be at least 8 characters");
    const target = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    const passwordHash = await this.deps.createPasswordHash(temporaryPassword);
    await this.deps.db.update(userAuthPassword).set({ passwordHash: passwordHash.passwordHash, salt: passwordHash.salt, updatedAt: this.now().toISOString() }).where(eq(userAuthPassword.userId, targetUserId));
    await this.deps.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user_auth", action: "reset_password", actorId, entityId: targetUserId });
    return ok({ temporary_password: temporaryPassword });
  }

  async listRoles(): Promise<ServiceResult<unknown[]>> {
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const roleRows = await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).orderBy(desc(roles.level), roles.name);
    const roleIds = roleRows.map((r) => r.id);
    const permissionRows = roleIds.length > 0 ? await this.deps.db.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds)) : [];
    const assignedRows = await this.deps.db.select({ roleId: users.role, count: sql<number>`count(*)` }).from(users).where(isNull(users.deletedAt)).groupBy(users.role);
    const assignedCountByRole = new Map<string, number>(assignedRows.map((r) => [r.roleId, Number(r.count ?? 0)]));
    return ok(roleRows.map((r) => adminRoleSchema.parse({ id: r.id, name: r.name, level: r.level, color: r.color, is_builtin: r.isBuiltin, created_at: r.createdAt, updated_at: r.updatedAt, permissions: parsePermissionRecord(r.id, permissionRows.filter((p) => p.roleId === r.id).map((p) => ({ permission: p.permission, granted: p.granted }))), assigned_user_count: assignedCountByRole.get(r.id) ?? 0 })));
  }

  async createRole(actorId: string, input: { id?: string; name: string; level: number; color?: string; permissions?: Record<string, boolean> }): Promise<ServiceResult<unknown>> {
    const roleId = (input.id?.trim() || `custom_${this.deps.generateId().toLowerCase()}`).toLowerCase();
    if ((ROLES as readonly string[]).includes(roleId)) return err("CONFLICT", "Built-in role ids are reserved");
    if (input.level > 2) return err("VALIDATION_ERROR", "Custom role level must be 1 or 2");
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const existing = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (existing) return err("CONFLICT", "Role id already exists");
    await this.deps.db.insert(roles).values({ id: roleId, name: input.name.trim(), level: input.level, color: input.color ?? null, isBuiltin: false });
    const permissionRecord = emptyPermissionRecord();
    for (const perm of PERMISSIONS) permissionRecord[perm] = Boolean(input.permissions?.[perm]);
    await replaceRolePermissions(this.deps.db, roleId, permissionRecord);
    await this.deps.writeAuditLog({ entityType: "role", action: "create", actorId, entityId: roleId, detailText: JSON.stringify({ name: input.name.trim(), level: input.level, color: input.color ?? null, permissions: permissionRecord }) });
    const created = (await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create role");
    return ok(adminRoleSchema.parse({ id: created.id, name: created.name, level: created.level, color: created.color, is_builtin: created.isBuiltin, created_at: created.createdAt, updated_at: created.updatedAt, permissions: permissionRecord, assigned_user_count: 0 }));
  }

  async updateRole(actorId: string, roleId: string, input: { name?: string; level?: number; color?: string | null; permissions?: Record<string, boolean> }): Promise<ServiceResult<unknown>> {
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const existing = (await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Role not found");
    if (existing.isBuiltin && input.level !== undefined && input.level !== existing.level) return err("CONFLICT", "Built-in role level is fixed");
    if (!existing.isBuiltin && input.level !== undefined && input.level > 2) return err("VALIDATION_ERROR", "Custom role level must be 1 or 2");
    const roleUpdatePayload: { name?: string; level?: number; color?: string | null; updatedAt: string } = { updatedAt: this.now().toISOString() };
    if (input.name !== undefined) roleUpdatePayload.name = input.name.trim();
    if (input.level !== undefined) roleUpdatePayload.level = input.level;
    if (input.color !== undefined) roleUpdatePayload.color = input.color ?? null;
    if (Object.keys(roleUpdatePayload).length > 1) await this.deps.db.update(roles).set(roleUpdatePayload).where(eq(roles.id, roleId));
    if (roleId === "admin") await replaceRolePermissions(this.deps.db, roleId, fullAdminPermissionRecord());
    else if (input.permissions) {
      const currentPermissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const nextPermissionRecord = parsePermissionRecord(roleId, currentPermissionRows);
      for (const perm of PERMISSIONS) if (Object.prototype.hasOwnProperty.call(input.permissions, perm)) nextPermissionRecord[perm] = Boolean(input.permissions[perm]);
      await replaceRolePermissions(this.deps.db, roleId, nextPermissionRecord);
    }
    const [updatedRole] = await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!updatedRole) return err("SERVER_ERROR", "Failed to load updated role");
    const permissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const assignedCountRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.role, roleId), isNull(users.deletedAt))).limit(1))[0];
    const assignedCount = Number(assignedCountRow?.count ?? 0);
    await this.deps.writeAuditLog({ entityType: "role", action: "update", actorId, entityId: roleId, detailText: JSON.stringify({ fields: input, assigned_user_count: assignedCount }) });
    return ok(adminRoleSchema.parse({ id: updatedRole.id, name: updatedRole.name, level: updatedRole.level, color: updatedRole.color, is_builtin: updatedRole.isBuiltin, created_at: updatedRole.createdAt, updated_at: updatedRole.updatedAt, permissions: parsePermissionRecord(roleId, permissionRows), assigned_user_count: assignedCount }));
  }

  async deleteRole(actorId: string, roleId: string): Promise<ServiceResult<void>> {
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const existing = (await this.deps.db.select({ id: roles.id, isBuiltin: roles.isBuiltin }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Role not found");
    if (existing.isBuiltin) return err("CONFLICT", "Built-in roles cannot be deleted");
    const assignedCountRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.role, roleId), isNull(users.deletedAt))).limit(1))[0];
    const assignedCount = Number(assignedCountRow?.count ?? 0);
    if (assignedCount > 0) return err("CONFLICT", "Role is assigned to users", { assigned_user_count: assignedCount });
    await this.deps.db.delete(roles).where(eq(roles.id, roleId));
    await this.deps.writeAuditLog({ entityType: "role", action: "delete", actorId, entityId: roleId });
    return ok(undefined);
  }

  async getBotSettings(): Promise<ServiceResult<BotSettings>> {
    return ok(await readBotSettingsFromMedia(this.deps.media));
  }

  async getDiscordChannels(guildIdOverride?: string): Promise<ServiceResult<Array<{ id: string; name: string; type: number }>>> {
    const settings = await readBotSettingsFromMedia(this.deps.media);
    const guildId = (guildIdOverride ?? settings.discord.guild_id).trim();
    if (!guildId) return err("VALIDATION_ERROR", "Discord guild_id is required");
    try {
      const channels = await this.deps.fetchDiscordChannels(guildId);
      return ok(channels);
    } catch (error) {
      return err("UPSTREAM_ERROR", "Failed to fetch Discord channels", { message: error instanceof Error ? error.message : "Unknown upstream error" });
    }
  }

  async updateBotSettings(actorId: string, settings: BotSettings): Promise<ServiceResult<void>> {
    await this.deps.media.put(BOT_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: "application/json" } });
    await this.deps.writeAuditLog({ entityType: "bot_settings", action: "update", actorId, entityId: "default" });
    return ok(undefined);
  }

  async testBotDispatch(actorId: string, platform: string): Promise<ServiceResult<{ task_id: string }>> {
    const settings = await readBotSettingsFromMedia(this.deps.media);
    const now = this.now().toISOString();
    if (platform === "discord") {
      const targetId = settings.discord.notification_channel_id || settings.discord.team_comp_channel_id;
      if (!targetId) return err("VALIDATION_ERROR", "Discord notification channel is not configured");
      const task = await this.deps.createBotTask({ platform: "discord", taskType: "event_notify", targetId, payload: { title: "[Test] Guild Notification", event_type: "system_test", start_at: now, capacity: "n/a", description: "Admin-triggered test notification from console." }, idempotencyKey: `admin-test:discord:${Date.now()}:${this.deps.generateId().slice(0, 6)}`, dispatchNow: true });
      await this.deps.writeAuditLog({ entityType: "bot_settings", action: "test_dispatch_discord", actorId, entityId: "default", detailText: JSON.stringify({ task_id: task.task_id, target_id: targetId }) });
      return ok({ task_id: task.task_id });
    }
    const targetId = settings.wechat.room_ids[0];
    if (!targetId) return err("VALIDATION_ERROR", "WeChat room id is not configured");
    const task = await this.deps.createBotTask({ platform: "wechat", taskType: "reminder", targetId, payload: { text: `[Test] Admin console test message at ${now}` }, idempotencyKey: `admin-test:wechat:${Date.now()}:${this.deps.generateId().slice(0, 6)}`, dispatchNow: true });
    await this.deps.writeAuditLog({ entityType: "bot_settings", action: "test_dispatch_wechat", actorId, entityId: "default", detailText: JSON.stringify({ task_id: task.task_id, target_id: targetId }) });
    return ok({ task_id: task.task_id });
  }

  async getStatus(): Promise<ServiceResult<{ db: string; r2: string; ws: string; crons: string; db_checks: Record<string, string> }>> {
    if (!this.deps.rawDb) return err("SERVER_ERROR", "Raw DB not available");
    let dbStatus = "ok";
    let r2Status = "ok";
    const dbChecks: Record<string, string> = {};
    const requiredTables = ["users", "member_profiles", "roles", "role_permissions"] as const;
    try {
      for (const table of requiredTables) {
        const row = await this.deps.rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(table).first<{ name: string }>();
        dbChecks[table] = row?.name ? "ok" : "missing";
      }
      if (requiredTables.some((t) => dbChecks[t] !== "ok")) dbStatus = "error";
    } catch {
      dbStatus = "error";
      for (const table of requiredTables) dbChecks[table] = "error";
    }
    try {
      await this.deps.media.head(BOT_SETTINGS_KEY);
    } catch {
      r2Status = "error";
    }
    return ok({ db: dbStatus, r2: r2Status, ws: this.deps.ws ? "ok" : "missing", crons: "ok", db_checks: dbChecks });
  }

  async getAnalyticsSettings(): Promise<ServiceResult<AnalyticsSettings>> {
    const object = await this.deps.media.get(ANALYTICS_SETTINGS_KEY);
    if (!object) return ok(defaultAnalyticsSettings());
    try {
      const parsed = JSON.parse(await object.text()) as AnalyticsSettings;
      return ok({ ...defaultAnalyticsSettings(), ...parsed });
    } catch {
      return ok(defaultAnalyticsSettings());
    }
  }

  async updateAnalyticsSettings(actorId: string, input: Record<string, unknown>): Promise<ServiceResult<AnalyticsSettings>> {
    const settings = normalizeAnalyticsWeights(parseAnalyticsInput(input));
    await this.deps.media.put(ANALYTICS_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: "application/json" } });
    await this.deps.writeAuditLog({ entityType: "analytics_settings", action: "update", actorId, entityId: "default" });
    return ok(settings);
  }

  async listArchiveMonths(): Promise<ServiceResult<{ months: string[]; source: string }>> {
    const months = await listArchiveMonthsFromR2(this.deps.media);
    return ok({ months, source: "r2_manifest" });
  }

  async getArchiveMonth(month: string, page: number, limit: number): Promise<ServiceResult<unknown>> {
    if (!/^\d{4}-\d{2}$/.test(month)) return err("VALIDATION_ERROR", "month must match YYYY-MM");
    let rows: AuditArchiveRow[] = [];
    let source: "r2_manifest" = "r2_manifest";
    let manifest: AuditArchiveManifest | null = null;
    try {
      const resolved = await readArchiveMonthFromR2(this.deps.media, month);
      if (!resolved) return err("NOT_FOUND", "Archive month not found");
      rows = resolved.rows;
      source = resolved.source;
      manifest = resolved.manifest;
    } catch {
      return err("SERVER_ERROR", "Failed to read audit archive");
    }
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const pageRows = rows.slice(offset, offset + limit);
    return ok({ month, total, page, limit, total_pages: totalPages, source, manifest: manifest === null ? null : { generated_at: manifest.generated_at, total_rows: manifest.total_rows, file_count: manifest.files.length, total_size_bytes: manifest.files.reduce((sum, f) => sum + Math.max(0, f.size_bytes), 0) }, data: pageRows.map((r) => auditLogSchema.parse({ id: r.id, entity_type: r.entityType, action: r.action, actor_id: r.actorId, entity_id: r.entityId, diff_title: r.diffTitle, detail_text: r.detailText, created_at: r.createdAt })) });
  }

  async getArchiveDownloadLinks(actorId: string, month: string, format: string, buildDownloadUrl: (token: string) => string): Promise<ServiceResult<unknown>> {
    if (!/^\d{4}-\d{2}$/.test(month)) return err("VALIDATION_ERROR", "month must match YYYY-MM");
    if (format !== "raw_ndjson_gz" && format !== "csv") return err("VALIDATION_ERROR", "format must be raw_ndjson_gz or csv");
    const cutoff = new Date(Date.now() - ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS * 1000).toISOString();
    const recent = (await this.deps.db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.entityType, "audit_archive_export"), eq(auditLog.actorId, actorId), gte(auditLog.createdAt, cutoff))).limit(1))[0];
    if (recent) return err("RATE_LIMITED", `Archive export is limited to one action every ${ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS} seconds`);
    let files: AuditArchiveManifestFile[] | null;
    try {
      files = await readArchiveFilesForDownload(this.deps.media, month);
    } catch {
      return err("SERVER_ERROR", "Failed to read archive manifest");
    }
    if (!files || files.length === 0) return err("NOT_FOUND", "Archive month not found");
    const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + ARCHIVE_DOWNLOAD_TTL_SECONDS;
    const downloadFiles = await Promise.all(files.map(async (file) => {
      const token = await signArchiveDownloadToken(this.deps.signingSecret, { key: file.key, month, actor_id: actorId, exp: expiresAtEpochSeconds, nonce: this.deps.generateId().slice(0, 10) });
      return { key: file.key, row_count: file.row_count, size_bytes: file.size_bytes, expires_at: new Date(expiresAtEpochSeconds * 1000).toISOString(), url: buildDownloadUrl(token) };
    }));
    await this.deps.writeAuditLog({ entityType: "audit_archive_export", action: format === "csv" ? "export_csv" : "export_raw_ndjson_gz", actorId, entityId: month, detailText: JSON.stringify({ format, file_count: downloadFiles.length, ttl_seconds: ARCHIVE_DOWNLOAD_TTL_SECONDS }) });
    return ok({ month, format, expires_in_seconds: ARCHIVE_DOWNLOAD_TTL_SECONDS, files: downloadFiles });
  }

  async verifyAndGetArchiveFile(token: string): Promise<ServiceResult<{ body: ReadableStream; contentType: string; contentEncoding?: string; filename: string; actorId: string; month: string; key: string }>> {
    if (!token) return err("VALIDATION_ERROR", "token is required");
    const payload = await verifyArchiveDownloadToken(this.deps.signingSecret, token);
    if (!payload) return err("UNAUTHORIZED", "Invalid or expired download token");
    if (!payload.key.startsWith(`${ARCHIVE_PREFIX}/`)) return err("FORBIDDEN", "Invalid archive object key");
    const object = await this.deps.media.get(payload.key);
    if (!object || !object.body) return err("NOT_FOUND", "Archive file not found");
    await this.deps.writeAuditLog({ entityType: "audit_archive_export", action: "download_raw_ndjson_gz", actorId: payload.actor_id, entityId: payload.month, detailText: JSON.stringify({ key: payload.key }) });
    return ok({ body: object.body, contentType: object.httpMetadata?.contentType ?? "application/octet-stream", contentEncoding: object.httpMetadata?.contentEncoding, filename: payload.key.split("/").at(-1) ?? "archive.bin", actorId: payload.actor_id, month: payload.month, key: payload.key });
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
