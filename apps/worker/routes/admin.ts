import {
  ERROR_STATUS,
  auditLogSchema,
  batchDeactivateSchema,
  batchRoleChangeSchema,
  botSettingsSchema,
  createInviteLinkSchema,
  hasRoleAtLeast,
  inviteLinkSchema,
  inviteLinkStatsSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, desc, eq, gt, gte, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { customAlphabet, nanoid } from "nanoid";
import { auditLog, inviteLinks, sessions, userAuthPassword, users } from "../db/schema";
import type { Bindings } from "../index";
import { writeAuditLog } from "../services/audit";
import { createPasswordHash, resolveSession } from "../services/auth";
import { createBotTask, fetchDiscordChannelsFromBotRuntime } from "../services/bot-dispatch";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type BotSettings = {
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

type AuditArchiveRow = {
  id: string;
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle: string | null;
  detailText: string | null;
  createdAt: string;
};

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

type AuditArchiveReadResult = {
  rows: AuditArchiveRow[];
  source: "r2_manifest" | "r2_legacy_json";
  manifest: AuditArchiveManifest | null;
};

const BOT_SETTINGS_KEY = "config/bot-settings.json";
const AUDIT_ARCHIVE_PREFIX = "audit-archive";
const generateInviteCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
const generateTemporaryPassword = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", 12);
const AUDIT_LOG_DEFAULT_RANGE_DAYS = 90;
const AUDIT_LOG_MAX_RANGE_DAYS = 365;
const AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS = 15 * 60;
const AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS = 60;
const AUDIT_ARCHIVE_DOWNLOAD_FILE_PATH = "/api/admin/audit-archive/download/file";
const DAY_MS = 24 * 60 * 60 * 1000;

export const adminRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

async function requireRole(c: Context, requiredRole: Role): Promise<SessionUser | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }

  if (!hasRoleAtLeast(resolved.user.role, requiredRole)) {
    return buildError(c, "FORBIDDEN", "Insufficient role");
  }

  return resolved.user;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseIsoDateTime(value: string | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeAuditArchiveRow(value: unknown): AuditArchiveRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : null;
  const entityType =
    typeof row.entityType === "string"
      ? row.entityType
      : typeof row.entity_type === "string"
        ? row.entity_type
        : null;
  const action = typeof row.action === "string" ? row.action : null;
  const actorId =
    typeof row.actorId === "string"
      ? row.actorId
      : typeof row.actor_id === "string"
        ? row.actor_id
        : null;
  const entityId =
    typeof row.entityId === "string"
      ? row.entityId
      : typeof row.entity_id === "string"
        ? row.entity_id
        : null;
  const createdAt =
    typeof row.createdAt === "string"
      ? row.createdAt
      : typeof row.created_at === "string"
        ? row.created_at
        : null;
  if (!id || !entityType || !action || !actorId || !entityId || !createdAt) {
    return null;
  }
  return {
    id,
    entityType,
    action,
    actorId,
    entityId,
    diffTitle:
      typeof row.diffTitle === "string"
        ? row.diffTitle
        : typeof row.diff_title === "string"
          ? row.diff_title
          : null,
    detailText:
      typeof row.detailText === "string"
        ? row.detailText
        : typeof row.detail_text === "string"
          ? row.detail_text
          : null,
    createdAt,
  };
}

function archiveMonthPaths(month: string): { manifestKey: string; legacyJsonKey: string } {
  const [year, monthNumber] = month.split("-");
  return {
    manifestKey: `${AUDIT_ARCHIVE_PREFIX}/${year}/${monthNumber}/manifest.json`,
    legacyJsonKey: `${AUDIT_ARCHIVE_PREFIX}/${month}.json`,
  };
}

function normalizeArchiveManifestFile(value: unknown): AuditArchiveManifestFile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const key = typeof row.key === "string" ? row.key : null;
  const rowCount = typeof row.row_count === "number" ? row.row_count : null;
  const sizeBytes = typeof row.size_bytes === "number" ? row.size_bytes : null;
  if (!key || rowCount === null || sizeBytes === null) {
    return null;
  }
  return {
    key,
    row_count: rowCount,
    size_bytes: sizeBytes,
    content_encoding: typeof row.content_encoding === "string" ? row.content_encoding : undefined,
    content_type: typeof row.content_type === "string" ? row.content_type : undefined,
  };
}

function normalizeAuditArchiveManifest(value: unknown, month: string): AuditArchiveManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const payloadMonth = typeof record.month === "string" ? record.month : null;
  const generatedAt = typeof record.generated_at === "string" ? record.generated_at : null;
  const totalRows = typeof record.total_rows === "number" ? record.total_rows : null;
  const entitiesRaw = record.entities;
  const filesRaw = record.files;

  if (payloadMonth !== month || !generatedAt || totalRows === null || !Array.isArray(filesRaw)) {
    return null;
  }

  const files = filesRaw.map(normalizeArchiveManifestFile);
  if (files.some((item) => item === null)) {
    return null;
  }

  const entities: Record<string, number> = {};
  if (entitiesRaw && typeof entitiesRaw === "object" && !Array.isArray(entitiesRaw)) {
    for (const [entityType, count] of Object.entries(entitiesRaw)) {
      if (typeof count === "number") {
        entities[entityType] = count;
      }
    }
  }

  return {
    month: payloadMonth,
    generated_at: generatedAt,
    total_rows: totalRows,
    entities,
    files: files as AuditArchiveManifestFile[],
  };
}

async function decompressGzipText(buffer: ArrayBuffer): Promise<string> {
  const decompression = new DecompressionStream("gzip");
  const decompressedStream = new Blob([buffer]).stream().pipeThrough(decompression);
  return await new Response(decompressedStream).text();
}

function parseArchiveRowsFromNdjson(ndjson: string): AuditArchiveRow[] {
  if (!ndjson.trim()) {
    return [];
  }

  const lines = ndjson
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const normalized = lines.map((line) => normalizeAuditArchiveRow(JSON.parse(line) as unknown));
  if (normalized.some((row) => row === null)) {
    throw new Error("Invalid archive row shape");
  }
  return normalized as AuditArchiveRow[];
}

async function readArchiveRowsFromManifest(env: Bindings, manifest: AuditArchiveManifest): Promise<AuditArchiveRow[]> {
  const rows: AuditArchiveRow[] = [];
  for (const file of manifest.files) {
    const object = await env.MEDIA.get(file.key);
    if (!object) {
      throw new Error(`Missing archive file ${file.key}`);
    }
    const shouldDecompress =
      file.key.endsWith(".gz") ||
      file.content_encoding?.toLowerCase() === "gzip" ||
      object.httpMetadata?.contentEncoding?.toLowerCase() === "gzip";
    const text = shouldDecompress ? await decompressGzipText(await object.arrayBuffer()) : await object.text();
    rows.push(...parseArchiveRowsFromNdjson(text));
  }
  return rows;
}

async function listArchiveMonthsFromR2(env: Bindings): Promise<string[]> {
  const months = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({
      prefix: `${AUDIT_ARCHIVE_PREFIX}/`,
      cursor,
      limit: 1000,
    });
    for (const object of page.objects) {
      const manifestMatch = /^audit-archive\/(\d{4})\/(\d{2})\/manifest\.json$/.exec(object.key);
      if (manifestMatch?.[1] && manifestMatch?.[2]) {
        months.add(`${manifestMatch[1]}-${manifestMatch[2]}`);
        continue;
      }

      const legacyMatch = /^audit-archive\/(\d{4}-\d{2})\.json$/.exec(object.key);
      if (legacyMatch?.[1]) {
        months.add(legacyMatch[1]);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return Array.from(months).sort((left, right) => right.localeCompare(left));
}

async function readArchiveMonthFromR2(env: Bindings, month: string): Promise<AuditArchiveReadResult | null> {
  const { manifestKey, legacyJsonKey } = archiveMonthPaths(month);
  const manifestObject = await env.MEDIA.get(manifestKey);
  if (manifestObject) {
    const parsedManifest = normalizeAuditArchiveManifest(JSON.parse(await manifestObject.text()) as unknown, month);
    if (!parsedManifest) {
      throw new Error("Invalid archive manifest");
    }
    const rows = await readArchiveRowsFromManifest(env, parsedManifest);
    return {
      rows,
      source: "r2_manifest",
      manifest: parsedManifest,
    };
  }

  const legacyObject = await env.MEDIA.get(legacyJsonKey);
  if (!legacyObject) {
    return null;
  }

  const payload = JSON.parse(await legacyObject.text()) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid archive payload");
  }

  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error("Invalid archive rows");
  }
  const normalized = rows.map(normalizeAuditArchiveRow);
  if (normalized.some((row) => row === null)) {
    throw new Error("Invalid archive row shape");
  }
  return {
    rows: normalized as AuditArchiveRow[],
    source: "r2_legacy_json",
    manifest: null,
  };
}

function defaultBotSettings(): BotSettings {
  return {
    discord: {
      guild_id: "",
      notification_channel_id: "",
      team_comp_channel_id: "",
      default_toggles: {},
    },
    wechat: {
      room_ids: [],
      default_toggles: {},
    },
  };
}

async function readBotSettings(c: Context): Promise<BotSettings> {
  const env = c.env as Bindings;
  const object = await env.MEDIA.get(BOT_SETTINGS_KEY);
  if (!object) {
    return defaultBotSettings();
  }

  try {
    const parsed = JSON.parse(await object.text()) as unknown;
    return botSettingsSchema.parse(parsed);
  } catch {
    return defaultBotSettings();
  }
}

async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }
}

type SignedArchiveDownloadPayload = {
  key: string;
  month: string;
  actor_id: string;
  exp: number;
  nonce: string;
};

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  return copied.buffer;
}

function utf8ArrayBuffer(value: string): ArrayBuffer {
  return toArrayBuffer(utf8Encode(value));
}

function utf8Decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function base64UrlEncode(value: Uint8Array): string {
  const raw = String.fromCharCode(...value);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function createHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", utf8ArrayBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function archiveSigningSecret(env: Bindings): string {
  return env.BOT_SHARED_SECRET ?? "local-dev-audit-archive-signing-secret";
}

async function signArchiveDownloadToken(secret: string, payload: SignedArchiveDownloadPayload): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(utf8Encode(payloadJson));
  const key = await createHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, utf8ArrayBuffer(payloadEncoded));
  return `${payloadEncoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyArchiveDownloadToken(
  secret: string,
  token: string,
): Promise<SignedArchiveDownloadPayload | null> {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const key = await createHmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(base64UrlDecode(signaturePart)),
    utf8ArrayBuffer(payloadPart),
  );
  if (!valid) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(base64UrlDecode(payloadPart))) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const keyValue = typeof payload.key === "string" ? payload.key : null;
  const month = typeof payload.month === "string" ? payload.month : null;
  const actorId = typeof payload.actor_id === "string" ? payload.actor_id : null;
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const nonce = typeof payload.nonce === "string" ? payload.nonce : null;
  if (!keyValue || !month || !actorId || exp === null || !nonce) {
    return null;
  }
  if (exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return {
    key: keyValue,
    month,
    actor_id: actorId,
    exp,
    nonce,
  };
}

function buildArchiveDownloadUrl(c: Context, token: string): string {
  const url = new URL(c.req.url);
  url.pathname = AUDIT_ARCHIVE_DOWNLOAD_FILE_PATH;
  url.search = new URLSearchParams({ token }).toString();
  return url.toString();
}

async function enforceArchiveExportRateLimit(c: Context, actorId: string): Promise<Response | null> {
  const cutoff = new Date(Date.now() - AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS * 1000).toISOString();
  const db = getDb(c);
  const recent = (
    await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "audit_archive_export"),
          eq(auditLog.actorId, actorId),
          gte(auditLog.createdAt, cutoff),
        ),
      )
      .limit(1)
  )[0];

  if (recent) {
    return buildError(
      c,
      "RATE_LIMITED",
      `Archive export is limited to one action every ${AUDIT_ARCHIVE_EXPORT_MIN_INTERVAL_SECONDS} seconds`,
    );
  }

  return null;
}

async function readArchiveMonthFromD1(c: Context, month: string): Promise<AuditArchiveRow[]> {
  const db = getDb(c);
  return await db
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
    .where(like(auditLog.createdAt, `${month}-%`))
    .orderBy(desc(auditLog.createdAt));
}

async function resolveArchiveMonth(c: Context, month: string): Promise<{
  rows: AuditArchiveRow[];
  source: "r2_manifest" | "r2_legacy_json" | "d1_legacy";
  manifest: AuditArchiveManifest | null;
}> {
  const env = c.env as Bindings;
  const archived = await readArchiveMonthFromR2(env, month);
  if (archived) {
    return archived;
  }
  const rows = await readArchiveMonthFromD1(c, month);
  return {
    rows,
    source: "d1_legacy",
    manifest: null,
  };
}

async function readArchiveManifestFromR2(env: Bindings, month: string): Promise<AuditArchiveManifest | null> {
  const { manifestKey } = archiveMonthPaths(month);
  const manifestObject = await env.MEDIA.get(manifestKey);
  if (!manifestObject) {
    return null;
  }
  const parsedManifest = normalizeAuditArchiveManifest(JSON.parse(await manifestObject.text()) as unknown, month);
  if (!parsedManifest) {
    throw new Error("Invalid archive manifest");
  }
  return parsedManifest;
}

async function readArchiveFilesForDownload(env: Bindings, month: string): Promise<AuditArchiveManifestFile[] | null> {
  const manifest = await readArchiveManifestFromR2(env, month);
  if (manifest) {
    return manifest.files;
  }

  const { legacyJsonKey } = archiveMonthPaths(month);
  const legacyHead = await env.MEDIA.head(legacyJsonKey);
  if (!legacyHead) {
    return null;
  }

  return [
    {
      key: legacyJsonKey,
      row_count: 0,
      size_bytes: legacyHead.size,
      content_type: "application/json",
      content_encoding: undefined,
    },
  ];
}

adminRoutes.get("/invite-links", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const includeExpired = parseBoolean(c.req.query("include_expired")) ?? false;
  const includeRevoked = parseBoolean(c.req.query("include_revoked")) ?? false;
  const nowIso = new Date().toISOString();

  const filters: SQL<unknown>[] = [];
  if (!includeRevoked) {
    filters.push(isNull(inviteLinks.revokedAt));
  }
  if (!includeExpired) {
    filters.push(or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, nowIso))!);
  }

  const db = getDb(c);
  const rows = await db
    .select({
      id: inviteLinks.id,
      code: inviteLinks.code,
      createdBy: inviteLinks.createdBy,
      maxUses: inviteLinks.maxUses,
      usedCount: inviteLinks.usedCount,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
      revokedAt: inviteLinks.revokedAt,
    })
    .from(inviteLinks)
    .where(and(...filters))
    .orderBy(desc(inviteLinks.createdAt));

  return c.json(
    rows.map((row) =>
      inviteLinkSchema.parse({
        id: row.id,
        code: row.code,
        created_by: row.createdBy,
        max_uses: row.maxUses,
        used_count: row.usedCount,
        expires_at: row.expiresAt,
        created_at: row.createdAt,
        revoked_at: row.revokedAt,
      }),
    ),
  );
});

adminRoutes.get("/invite-links/stats", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const nowIso = new Date().toISOString();
  const db = getDb(c);
  const rows = await db
    .select({
      id: inviteLinks.id,
      usedCount: inviteLinks.usedCount,
      maxUses: inviteLinks.maxUses,
      expiresAt: inviteLinks.expiresAt,
      revokedAt: inviteLinks.revokedAt,
    })
    .from(inviteLinks);

  const stats = rows.map((row) =>
    inviteLinkStatsSchema.parse({
      id: row.id,
      used_count: row.usedCount,
      max_uses: row.maxUses,
      expires_at: row.expiresAt,
      revoked_at: row.revokedAt,
    }),
  );

  const revoked = stats.filter((item) => item.revoked_at !== null).length;
  const expired = stats.filter((item) => item.expires_at !== null && item.expires_at <= nowIso).length;
  const active = stats.filter(
    (item) =>
      item.revoked_at === null &&
      (item.expires_at === null || item.expires_at > nowIso) &&
      item.used_count < item.max_uses,
  ).length;

  return c.json({
    total: stats.length,
    active,
    revoked,
    expired,
    data: stats,
  });
});

adminRoutes.post("/invite-links", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = createInviteLinkSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid invite payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const inviteId = nanoid();
  const code = generateInviteCode();

  await db.insert(inviteLinks).values({
    id: inviteId,
    code,
    createdBy: sessionUser.id,
    maxUses: parsed.data.max_uses,
    usedCount: 0,
    expiresAt: parsed.data.expires_at ?? null,
    revokedAt: null,
  });

  const created = (
    await db
      .select({
        id: inviteLinks.id,
        code: inviteLinks.code,
        createdBy: inviteLinks.createdBy,
        maxUses: inviteLinks.maxUses,
        usedCount: inviteLinks.usedCount,
        expiresAt: inviteLinks.expiresAt,
        createdAt: inviteLinks.createdAt,
        revokedAt: inviteLinks.revokedAt,
      })
      .from(inviteLinks)
      .where(eq(inviteLinks.id, inviteId))
      .limit(1)
  )[0];

  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create invite link");
  }

  await writeAuditLog(c, {
    entityType: "invite_link",
    action: "create",
    actorId: sessionUser.id,
    entityId: inviteId,
    diffTitle: code,
    detailText: JSON.stringify({ max_uses: parsed.data.max_uses, expires_at: parsed.data.expires_at ?? null }),
  });

  return c.json(
    inviteLinkSchema.parse({
      id: created.id,
      code: created.code,
      created_by: created.createdBy,
      max_uses: created.maxUses,
      used_count: created.usedCount,
      expires_at: created.expiresAt,
      created_at: created.createdAt,
      revoked_at: created.revokedAt,
    }),
    201,
  );
});

adminRoutes.delete("/invite-links/:id", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const inviteId = c.req.param("id");
  const db = getDb(c);
  const existing = (
    await db
      .select({
        id: inviteLinks.id,
        code: inviteLinks.code,
        revokedAt: inviteLinks.revokedAt,
      })
      .from(inviteLinks)
      .where(eq(inviteLinks.id, inviteId))
      .limit(1)
  )[0];

  if (!existing) {
    return buildError(c, "NOT_FOUND", "Invite link not found");
  }
  if (existing.revokedAt !== null) {
    return buildError(c, "CONFLICT", "Invite link already revoked");
  }

  await db
    .update(inviteLinks)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(inviteLinks.id, inviteId));

  await writeAuditLog(c, {
    entityType: "invite_link",
    action: "revoke",
    actorId: sessionUser.id,
    entityId: inviteId,
    diffTitle: existing.code,
  });

  return c.json({ ok: true });
});

adminRoutes.get("/audit-log", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const page = parsePage(c.req.query("page"), 1);
  const limit = Math.min(50, parsePage(c.req.query("limit"), 50));
  const offset = (page - 1) * limit;
  const entityType = (c.req.query("entity_type") ?? "").trim();
  const actorId = (c.req.query("actor_id") ?? "").trim();
  const search = (c.req.query("search") ?? "").trim();
  const startAtQuery = (c.req.query("start_at") ?? "").trim();
  const endAtQuery = (c.req.query("end_at") ?? "").trim();

  let resolvedStartAt: string;
  let resolvedEndAt: string;
  if (!startAtQuery && !endAtQuery) {
    const now = new Date();
    resolvedEndAt = now.toISOString();
    resolvedStartAt = new Date(now.getTime() - AUDIT_LOG_DEFAULT_RANGE_DAYS * DAY_MS).toISOString();
  } else if (startAtQuery && endAtQuery) {
    const parsedStartAt = parseIsoDateTime(startAtQuery);
    const parsedEndAt = parseIsoDateTime(endAtQuery);
    if (!parsedStartAt || !parsedEndAt) {
      return buildError(c, "VALIDATION_ERROR", "start_at and end_at must be valid ISO datetime");
    }
    if (parsedStartAt > parsedEndAt) {
      return buildError(c, "VALIDATION_ERROR", "start_at must be earlier than end_at");
    }
    if (new Date(parsedEndAt).getTime() - new Date(parsedStartAt).getTime() > AUDIT_LOG_MAX_RANGE_DAYS * DAY_MS) {
      return buildError(c, "VALIDATION_ERROR", `Date range must be within ${AUDIT_LOG_MAX_RANGE_DAYS} days`);
    }
    resolvedStartAt = parsedStartAt;
    resolvedEndAt = parsedEndAt;
  } else {
    return buildError(c, "VALIDATION_ERROR", "start_at and end_at must be provided together");
  }

  const filters: SQL<unknown>[] = [];
  if (entityType) {
    filters.push(eq(auditLog.entityType, entityType));
  }
  if (actorId) {
    filters.push(eq(auditLog.actorId, actorId));
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    filters.push(
      or(
        like(auditLog.action, pattern),
        like(auditLog.entityId, pattern),
        like(auditLog.diffTitle, pattern),
        like(auditLog.detailText, pattern),
      )!,
    );
  }
  filters.push(gte(auditLog.createdAt, resolvedStartAt));
  filters.push(lte(auditLog.createdAt, resolvedEndAt));

  const whereClause = and(...filters);
  const db = getDb(c);
  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(whereClause)
  )[0];
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
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
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((row) =>
      auditLogSchema.parse({
        id: row.id,
        entity_type: row.entityType,
        action: row.action,
        actor_id: row.actorId,
        entity_id: row.entityId,
        diff_title: row.diffTitle,
        detail_text: row.detailText,
        created_at: row.createdAt,
      }),
    ),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    start_at: resolvedStartAt,
    end_at: resolvedEndAt,
  });
});

adminRoutes.get("/audit-log/export", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const format = (c.req.query("format") ?? "csv").trim().toLowerCase();
  if (format !== "csv" && format !== "json") {
    return buildError(c, "VALIDATION_ERROR", "format must be csv or json");
  }

  const entityType = (c.req.query("entity_type") ?? "").trim();
  const actorId = (c.req.query("actor_id") ?? "").trim();
  const search = (c.req.query("search") ?? "").trim();
  const startAtQuery = (c.req.query("start_at") ?? "").trim();
  const endAtQuery = (c.req.query("end_at") ?? "").trim();

  let resolvedStartAt: string;
  let resolvedEndAt: string;
  if (!startAtQuery && !endAtQuery) {
    const now = new Date();
    resolvedEndAt = now.toISOString();
    resolvedStartAt = new Date(now.getTime() - AUDIT_LOG_DEFAULT_RANGE_DAYS * DAY_MS).toISOString();
  } else if (startAtQuery && endAtQuery) {
    const parsedStartAt = parseIsoDateTime(startAtQuery);
    const parsedEndAt = parseIsoDateTime(endAtQuery);
    if (!parsedStartAt || !parsedEndAt) {
      return buildError(c, "VALIDATION_ERROR", "start_at and end_at must be valid ISO datetime");
    }
    if (parsedStartAt > parsedEndAt) {
      return buildError(c, "VALIDATION_ERROR", "start_at must be earlier than end_at");
    }
    if (new Date(parsedEndAt).getTime() - new Date(parsedStartAt).getTime() > AUDIT_LOG_MAX_RANGE_DAYS * DAY_MS) {
      return buildError(c, "VALIDATION_ERROR", `Date range must be within ${AUDIT_LOG_MAX_RANGE_DAYS} days`);
    }
    resolvedStartAt = parsedStartAt;
    resolvedEndAt = parsedEndAt;
  } else {
    return buildError(c, "VALIDATION_ERROR", "start_at and end_at must be provided together");
  }

  const filters: SQL<unknown>[] = [];
  if (entityType) {
    filters.push(eq(auditLog.entityType, entityType));
  }
  if (actorId) {
    filters.push(eq(auditLog.actorId, actorId));
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    filters.push(
      or(
        like(auditLog.action, pattern),
        like(auditLog.entityId, pattern),
        like(auditLog.diffTitle, pattern),
        like(auditLog.detailText, pattern),
      )!,
    );
  }
  filters.push(gte(auditLog.createdAt, resolvedStartAt));
  filters.push(lte(auditLog.createdAt, resolvedEndAt));

  const whereClause = and(...filters);
  const db = getDb(c);
  const rows = await db
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
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt));

  const serializedRows = rows.map((row) =>
    auditLogSchema.parse({
      id: row.id,
      entity_type: row.entityType,
      action: row.action,
      actor_id: row.actorId,
      entity_id: row.entityId,
      diff_title: row.diffTitle,
      detail_text: row.detailText,
      created_at: row.createdAt,
    }),
  );

  const rangeStartLabel = resolvedStartAt.slice(0, 10);
  const rangeEndLabel = resolvedEndAt.slice(0, 10);
  const filenameBase = `guild-audit-${rangeStartLabel}-to-${rangeEndLabel}`;

  await writeAuditLog(c, {
    entityType: "audit_log_export",
    action: format === "csv" ? "export_filtered_csv" : "export_filtered_json",
    actorId: sessionUser.id,
    entityId: "audit-log",
    detailText: JSON.stringify({
      format,
      start_at: resolvedStartAt,
      end_at: resolvedEndAt,
      total: serializedRows.length,
      filters: {
        entity_type: entityType || null,
        actor_id: actorId || null,
        search: search || null,
      },
    }),
  });

  if (format === "json") {
    const payload = {
      exported_at: new Date().toISOString(),
      start_at: resolvedStartAt,
      end_at: resolvedEndAt,
      total: serializedRows.length,
      data: serializedRows,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const csvCell = (value: string | null) => {
    if (value === null) {
      return "";
    }
    const escaped = value.replace(/"/g, "\"\"");
    return `"${escaped}"`;
  };
  const csvLines = [
    ["id", "entity_type", "action", "actor_id", "entity_id", "diff_title", "detail_text", "created_at"].join(","),
    ...serializedRows.map((row) =>
      [
        csvCell(row.id),
        csvCell(row.entity_type),
        csvCell(row.action),
        csvCell(row.actor_id),
        csvCell(row.entity_id),
        csvCell(row.diff_title),
        csvCell(row.detail_text),
        csvCell(row.created_at),
      ].join(","),
    ),
  ];

  return new Response(csvLines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
});

adminRoutes.get("/audit-archive/months", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const env = c.env as Bindings;
  const archivedMonths = await listArchiveMonthsFromR2(env);
  if (archivedMonths.length > 0) {
    return c.json({
      months: archivedMonths,
      source: "r2_archive",
    });
  }

  const result = await env.DB.prepare(
    "SELECT DISTINCT substr(created_at, 1, 7) AS month FROM audit_log ORDER BY month DESC",
  ).all<{ month: string }>();

  return c.json({
    months: (result.results ?? []).map((item) => item.month).filter((month): month is string => !!month),
    source: "d1_legacy",
  });
});

adminRoutes.get("/audit-archive/download", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const month = (c.req.query("month") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return buildError(c, "VALIDATION_ERROR", "month must match YYYY-MM");
  }
  const format = (c.req.query("format") ?? "raw_ndjson_gz").trim();
  if (format !== "raw_ndjson_gz" && format !== "csv") {
    return buildError(c, "VALIDATION_ERROR", "format must be raw_ndjson_gz or csv");
  }

  const rateLimited = await enforceArchiveExportRateLimit(c, sessionUser.id);
  if (rateLimited instanceof Response) {
    return rateLimited;
  }

  const env = c.env as Bindings;
  let files: AuditArchiveManifestFile[] | null;
  try {
    files = await readArchiveFilesForDownload(env, month);
  } catch {
    return buildError(c, "SERVER_ERROR", "Failed to read archive manifest");
  }
  if (!files || files.length === 0) {
    return buildError(c, "NOT_FOUND", "Archive month not found");
  }

  const secret = archiveSigningSecret(env);
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS;
  const downloadFiles = await Promise.all(
    files.map(async (file) => {
      const token = await signArchiveDownloadToken(secret, {
        key: file.key,
        month,
        actor_id: sessionUser.id,
        exp: expiresAtEpochSeconds,
        nonce: nanoid(10),
      });
      return {
        key: file.key,
        row_count: file.row_count,
        size_bytes: file.size_bytes,
        expires_at: new Date(expiresAtEpochSeconds * 1000).toISOString(),
        url: buildArchiveDownloadUrl(c, token),
      };
    }),
  );

  await writeAuditLog(c, {
    entityType: "audit_archive_export",
    action: format === "csv" ? "export_csv" : "export_raw_ndjson_gz",
    actorId: sessionUser.id,
    entityId: month,
    detailText: JSON.stringify({
      format,
      file_count: downloadFiles.length,
      ttl_seconds: AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS,
    }),
  });

  return c.json({
    month,
    format,
    expires_in_seconds: AUDIT_ARCHIVE_DOWNLOAD_TTL_SECONDS,
    files: downloadFiles,
  });
});

adminRoutes.get("/audit-archive/download/file", async (c) => {
  const token = (c.req.query("token") ?? "").trim();
  if (!token) {
    return buildError(c, "VALIDATION_ERROR", "token is required");
  }

  const env = c.env as Bindings;
  const payload = await verifyArchiveDownloadToken(archiveSigningSecret(env), token);
  if (!payload) {
    return buildError(c, "UNAUTHORIZED", "Invalid or expired download token");
  }
  if (!payload.key.startsWith(`${AUDIT_ARCHIVE_PREFIX}/`)) {
    return buildError(c, "FORBIDDEN", "Invalid archive object key");
  }

  const object = await env.MEDIA.get(payload.key);
  if (!object || !object.body) {
    return buildError(c, "NOT_FOUND", "Archive file not found");
  }

  await writeAuditLog(c, {
    entityType: "audit_archive_export",
    action: "download_raw_ndjson_gz",
    actorId: payload.actor_id,
    entityId: payload.month,
    detailText: JSON.stringify({ key: payload.key }),
  });

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (object.httpMetadata?.contentEncoding) {
    headers.set("Content-Encoding", object.httpMetadata.contentEncoding);
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `attachment; filename="${payload.key.split("/").at(-1) ?? "archive.bin"}"`);

  return new Response(object.body, {
    status: 200,
    headers,
  });
});

adminRoutes.get("/audit-archive/:month", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const month = c.req.param("month");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return buildError(c, "VALIDATION_ERROR", "month must match YYYY-MM");
  }

  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));

  let rows: AuditArchiveRow[] = [];
  let source: "r2_manifest" | "r2_legacy_json" | "d1_legacy" = "d1_legacy";
  let manifest: AuditArchiveManifest | null = null;
  try {
    const resolved = await resolveArchiveMonth(c, month);
    rows = resolved.rows;
    source = resolved.source;
    manifest = resolved.manifest;
  } catch {
    return buildError(c, "SERVER_ERROR", "Failed to read audit archive");
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  const pageRows = rows.slice(offset, offset + limit);

  return c.json({
    month,
    total,
    page,
    limit,
    total_pages: totalPages,
    source,
    manifest:
      manifest === null
        ? null
        : {
            generated_at: manifest.generated_at,
            total_rows: manifest.total_rows,
            file_count: manifest.files.length,
            total_size_bytes: manifest.files.reduce(
              (sum, file) => sum + Math.max(0, file.size_bytes),
              0,
            ),
          },
    data: pageRows.map((row) =>
      auditLogSchema.parse({
        id: row.id,
        entity_type: row.entityType,
        action: row.action,
        actor_id: row.actorId,
        entity_id: row.entityId,
        diff_title: row.diffTitle,
        detail_text: row.detailText,
        created_at: row.createdAt,
      }),
    ),
  });
});

adminRoutes.patch("/users/batch/role", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = batchRoleChangeSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid batch role payload", parsed.error.flatten());
  }

  const targetIds = parsed.data.user_ids.filter((userId) => userId !== sessionUser.id);
  if (targetIds.length === 0) {
    return c.json({ ok: true, updated: 0 });
  }

  const db = getDb(c);
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));

  if (existingUsers.length > 0) {
    const existingIds = existingUsers.map((row) => row.id);
    await db
      .update(users)
      .set({
        role: parsed.data.new_role,
        updatedAt: new Date().toISOString(),
      })
      .where(inArray(users.id, existingIds));
  }

  await writeAuditLog(c, {
    entityType: "user",
    action: "batch_role_update",
    actorId: sessionUser.id,
    entityId: "batch",
    detailText: JSON.stringify({ user_ids: targetIds, new_role: parsed.data.new_role }),
  });

  return c.json({ ok: true, updated: existingUsers.length });
});

adminRoutes.patch("/users/batch/deactivate", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid batch deactivate payload", parsed.error.flatten());
  }

  const targetIds = parsed.data.user_ids.filter((userId) => userId !== sessionUser.id);
  if (targetIds.length === 0) {
    return c.json({ ok: true, updated: 0 });
  }

  const db = getDb(c);
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));

  if (existingUsers.length > 0) {
    const existingIds = existingUsers.map((row) => row.id);
    await db
      .update(users)
      .set({
        isActive: false,
        updatedAt: new Date().toISOString(),
      })
      .where(inArray(users.id, existingIds));

    await db.delete(sessions).where(inArray(sessions.userId, existingIds));
  }

  await writeAuditLog(c, {
    entityType: "user",
    action: "batch_deactivate",
    actorId: sessionUser.id,
    entityId: "batch",
    detailText: JSON.stringify({ user_ids: targetIds }),
  });

  return c.json({ ok: true, updated: existingUsers.length });
});

adminRoutes.patch("/users/batch/reactivate", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid batch reactivate payload", parsed.error.flatten());
  }

  const targetIds = parsed.data.user_ids.filter((userId) => userId !== sessionUser.id);
  if (targetIds.length === 0) {
    return c.json({ ok: true, updated: 0 });
  }

  const db = getDb(c);
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));

  if (existingUsers.length > 0) {
    const existingIds = existingUsers.map((row) => row.id);
    await db
      .update(users)
      .set({
        isActive: true,
        updatedAt: new Date().toISOString(),
      })
      .where(inArray(users.id, existingIds));
  }

  await writeAuditLog(c, {
    entityType: "user",
    action: "batch_reactivate",
    actorId: sessionUser.id,
    entityId: "batch",
    detailText: JSON.stringify({ user_ids: targetIds }),
  });

  return c.json({ ok: true, updated: existingUsers.length });
});

adminRoutes.patch("/users/batch/delete", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid batch delete payload", parsed.error.flatten());
  }

  const targetIds = parsed.data.user_ids.filter((userId) => userId !== sessionUser.id);
  if (targetIds.length === 0) {
    return c.json({ ok: true, updated: 0 });
  }

  const db = getDb(c);
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));

  if (existingUsers.length > 0) {
    const existingIds = existingUsers.map((row) => row.id);
    const now = new Date().toISOString();
    await db
      .update(users)
      .set({
        isActive: false,
        deletedAt: now,
        updatedAt: now,
      })
      .where(inArray(users.id, existingIds));

    await db.delete(sessions).where(inArray(sessions.userId, existingIds));
  }

  await writeAuditLog(c, {
    entityType: "user",
    action: "batch_delete",
    actorId: sessionUser.id,
    entityId: "batch",
    detailText: JSON.stringify({ user_ids: targetIds }),
  });

  return c.json({ ok: true, updated: existingUsers.length });
});

adminRoutes.patch("/users/:id/role", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (targetUserId === sessionUser.id) {
    return buildError(c, "CONFLICT", "You cannot change your own role");
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = batchRoleChangeSchema.shape.new_role.safeParse((body as { role?: unknown }).role);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid role payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const target = (
    await db
      .select({
        id: users.id,
        role: users.role,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
  )[0];

  if (!target || target.deletedAt !== null) {
    return buildError(c, "NOT_FOUND", "User not found");
  }

  await db
    .update(users)
    .set({
      role: parsed.data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, targetUserId));

  await writeAuditLog(c, {
    entityType: "user",
    action: "update_role",
    actorId: sessionUser.id,
    entityId: targetUserId,
    detailText: JSON.stringify({ from: target.role, to: parsed.data }),
  });

  return c.json({ ok: true });
});

adminRoutes.patch("/users/:id/deactivate", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (targetUserId === sessionUser.id) {
    return buildError(c, "CONFLICT", "You cannot deactivate yourself");
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") {
    return buildError(c, "VALIDATION_ERROR", "reason must be a string when provided");
  }

  const db = getDb(c);
  const target = (
    await db
      .select({
        id: users.id,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
  )[0];

  if (!target || target.deletedAt !== null) {
    return buildError(c, "NOT_FOUND", "User not found");
  }
  if (!target.isActive) {
    return buildError(c, "CONFLICT", "User already deactivated");
  }

  await db
    .update(users)
    .set({
      isActive: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, targetUserId));
  await db.delete(sessions).where(eq(sessions.userId, targetUserId));

  await writeAuditLog(c, {
    entityType: "user",
    action: "deactivate",
    actorId: sessionUser.id,
    entityId: targetUserId,
    detailText: JSON.stringify({ reason: typeof reason === "string" ? reason : null }),
  });

  return c.json({ ok: true });
});

adminRoutes.patch("/users/:id/reactivate", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") {
    return buildError(c, "VALIDATION_ERROR", "reason must be a string when provided");
  }

  const db = getDb(c);
  const target = (
    await db
      .select({
        id: users.id,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
  )[0];

  if (!target || target.deletedAt !== null) {
    return buildError(c, "NOT_FOUND", "User not found");
  }
  if (target.isActive) {
    return buildError(c, "CONFLICT", "User is already active");
  }

  await db
    .update(users)
    .set({
      isActive: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, targetUserId));

  await writeAuditLog(c, {
    entityType: "user",
    action: "reactivate",
    actorId: sessionUser.id,
    entityId: targetUserId,
    detailText: JSON.stringify({ reason: typeof reason === "string" ? reason : null }),
  });

  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const temporaryPasswordInput = (body as { temporary_password?: unknown }).temporary_password;
  if (temporaryPasswordInput !== undefined && typeof temporaryPasswordInput !== "string") {
    return buildError(c, "VALIDATION_ERROR", "temporary_password must be a string when provided");
  }

  const temporaryPassword = temporaryPasswordInput ?? generateTemporaryPassword();
  if (temporaryPassword.length < 8) {
    return buildError(c, "VALIDATION_ERROR", "temporary_password must be at least 8 characters");
  }

  const db = getDb(c);
  const target = (
    await db
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
  )[0];

  if (!target || target.deletedAt !== null) {
    return buildError(c, "NOT_FOUND", "User not found");
  }

  const passwordHash = await createPasswordHash(temporaryPassword);
  await db
    .update(userAuthPassword)
    .set({
      passwordHash: passwordHash.passwordHash,
      salt: passwordHash.salt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userAuthPassword.userId, targetUserId));
  await db.delete(sessions).where(eq(sessions.userId, targetUserId));

  await writeAuditLog(c, {
    entityType: "user_auth",
    action: "reset_password",
    actorId: sessionUser.id,
    entityId: targetUserId,
  });

  return c.json({ ok: true, temporary_password: temporaryPassword });
});

adminRoutes.get("/bot-settings", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  return c.json(await readBotSettings(c));
});

adminRoutes.get("/bot-settings/discord/channels", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const settings = await readBotSettings(c);
  const guildId = (c.req.query("guild_id") ?? settings.discord.guild_id).trim();
  if (!guildId) {
    return buildError(c, "VALIDATION_ERROR", "Discord guild_id is required");
  }

  try {
    const channels = await fetchDiscordChannelsFromBotRuntime(c.env as Bindings, guildId);
    return c.json({
      guild_id: guildId,
      channels,
    });
  } catch (error) {
    return buildError(c, "UPSTREAM_ERROR", "Failed to fetch Discord channels", {
      message: error instanceof Error ? error.message : "Unknown upstream error",
    });
  }
});

adminRoutes.patch("/bot-settings", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const parsed = botSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid bot settings payload", parsed.error.flatten());
  }

  const env = c.env as Bindings;
  await env.MEDIA.put(BOT_SETTINGS_KEY, JSON.stringify(parsed.data), {
    httpMetadata: {
      contentType: "application/json",
    },
  });

  await writeAuditLog(c, {
    entityType: "bot_settings",
    action: "update",
    actorId: sessionUser.id,
    entityId: "default",
  });

  return c.json({ ok: true });
});

adminRoutes.post("/bot-settings/test", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = await parseJsonBody(c);
  if (body instanceof Response) {
    return body;
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const platform = record.platform;
  if (platform !== "discord" && platform !== "wechat") {
    return buildError(c, "VALIDATION_ERROR", "platform must be discord or wechat");
  }

  const settings = await readBotSettings(c);
  const now = new Date().toISOString();

  if (platform === "discord") {
    const targetId = settings.discord.notification_channel_id || settings.discord.team_comp_channel_id;
    if (!targetId) {
      return buildError(c, "VALIDATION_ERROR", "Discord notification channel is not configured");
    }

    const task = await createBotTask(c.env as Bindings, {
      platform: "discord",
      taskType: "event_notify",
      targetId,
      payload: {
        title: "[Test] Guild Notification",
        event_type: "system_test",
        start_at: now,
        capacity: "n/a",
        description: "Admin-triggered test notification from console.",
      },
      idempotencyKey: `admin-test:discord:${Date.now()}:${nanoid(6)}`,
      dispatchNow: true,
    });

    await writeAuditLog(c, {
      entityType: "bot_settings",
      action: "test_dispatch_discord",
      actorId: sessionUser.id,
      entityId: "default",
      detailText: JSON.stringify({ task_id: task.task_id, target_id: targetId }),
    });

    return c.json({ ok: true, task_id: task.task_id });
  }

  const targetId = settings.wechat.room_ids[0];
  if (!targetId) {
    return buildError(c, "VALIDATION_ERROR", "WeChat room id is not configured");
  }

  const task = await createBotTask(c.env as Bindings, {
    platform: "wechat",
    taskType: "reminder",
    targetId,
    payload: {
      text: `[Test] Admin console test message at ${now}`,
    },
    idempotencyKey: `admin-test:wechat:${Date.now()}:${nanoid(6)}`,
    dispatchNow: true,
  });

  await writeAuditLog(c, {
    entityType: "bot_settings",
    action: "test_dispatch_wechat",
    actorId: sessionUser.id,
    entityId: "default",
    detailText: JSON.stringify({ task_id: task.task_id, target_id: targetId }),
  });

  return c.json({ ok: true, task_id: task.task_id });
});

adminRoutes.get("/status", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const env = c.env as Bindings;
  let dbStatus = "ok";
  let r2Status = "ok";

  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    dbStatus = "error";
  }

  try {
    await env.MEDIA.head(BOT_SETTINGS_KEY);
  } catch {
    r2Status = "error";
  }

  return c.json({
    db: dbStatus,
    r2: r2Status,
    ws: env.WS ? "ok" : "missing",
    crons: "ok",
  });
});
