import {
  analyticsSettingsSchema,
  batchDeactivateSchema,
  batchRoleChangeSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  createRoleSchema,
  updateRoleSchema,
} from "@guild/shared";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { customAlphabet, nanoid } from "nanoid";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog, writeAuditLogDurable } from "../services/audit";
import { AdminService, type MediaLike } from "../services/AdminService";
import { AdminAuditService, AuditLogQueryError } from "../services/AdminAuditService";
import { createPasswordHash } from "../services/auth";
import { errorLog } from "../db/schema/error-log";
import { buildError, parseBoolean, parseJsonBody } from "./_shared";

const generateInviteCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
const generateTemporaryPassword = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", 12);

export const adminRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function getAdminService(c: Context) {
  const env = c.env as Bindings;
  const db = getDb(c);
  return new AdminService({
    db,
    media: env.MEDIA as unknown as MediaLike,
    writeAuditLog: (input) => writeAuditLog(c, input),
    writeAuditLogDurable: (input) => writeAuditLogDurable(c, input),
    createPasswordHash,
    generateId: () => nanoid(),
    generateInviteCode: () => generateInviteCode(),
    generateTemporaryPassword: () => generateTemporaryPassword(),
    rawDb: env.DB,
    ws: env.WS,
  });
}

function getAdminAuditService(c: Context) {
  const env = c.env as Bindings;
  const db = getDb(c);
  return new AdminAuditService({
    db,
    media: env.MEDIA as unknown as MediaLike,
    writeAuditLog: (input) => writeAuditLog(c, input),
    generateId: () => nanoid(),
    signingSecret: env.SIGNING_SECRET ?? "",
  });
}

function buildArchiveDownloadUrl(c: Context, token: string): string {
  const url = new URL(c.req.url);
  url.pathname = "/api/admin/audit-archive/download/file";
  url.search = new URLSearchParams({ token }).toString();
  return url.toString();
}

// Invite Links
adminRoutes.get("/invite-links", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.view");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).listInviteLinks(parseBoolean(c.req.query("include_expired")) ?? false, parseBoolean(c.req.query("include_revoked")) ?? false);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  const canManage = sessionUser.permissions.has("admin.invite.manage");
  const data = canManage ? result.data : (result.data as Record<string, unknown>[]).map(({ code: _, ...rest }) => ({ ...rest, code: "••••••••" }));
  return c.json(data);
});

adminRoutes.get("/invite-links/stats", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.view");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).getInviteLinkStats();
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.post("/invite-links", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = createInviteLinkSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid invite payload", parsed.error.flatten());
  const result = await getAdminService(c).createInviteLink(sessionUser.id, parsed.data.max_uses, parsed.data.expires_at ?? null);
  return result.ok ? c.json(result.data, 201) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.delete("/invite-links/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).revokeInviteLink(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.delete("/invite-links/:id/permanent", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).deleteInviteLink(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message, result.details);
});

// User Management
adminRoutes.patch("/users/batch/role", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.role");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = batchRoleChangeSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch role payload", parsed.error.flatten());
  const result = await getAdminService(c).batchUpdateRole(sessionUser.id, parsed.data.user_ids, parsed.data.new_role);
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/users/batch/deactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch deactivate payload", parsed.error.flatten());
  const result = await getAdminService(c).batchDeactivate(sessionUser.id, parsed.data.user_ids);
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/users/batch/reactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch reactivate payload", parsed.error.flatten());
  const result = await getAdminService(c).batchReactivate(sessionUser.id, parsed.data.user_ids);
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/users/batch/delete", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.delete");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch delete payload", parsed.error.flatten());
  const result = await getAdminService(c).batchDelete(sessionUser.id, parsed.data.user_ids);
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.post("/users", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.edit");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = createAdminMemberSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid create member payload", parsed.error.flatten());
  const result = await getAdminService(c).createMember(sessionUser.id, parsed.data.username);
  return result.ok ? c.json({ ok: true, ...result.data }, 201) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/users/:id/role", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.role");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = batchRoleChangeSchema.shape.new_role.safeParse((body as { role?: unknown }).role);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role payload", parsed.error.flatten());
  const result = await getAdminService(c).updateUserRole(sessionUser.id, c.req.param("id"), parsed.data);
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/users/:id/deactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") return buildError(c, "VALIDATION_ERROR", "reason must be a string when provided");
  const result = await getAdminService(c).deactivateUser(sessionUser.id, c.req.param("id"), typeof reason === "string" ? reason : undefined);
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/users/:id/reactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") return buildError(c, "VALIDATION_ERROR", "reason must be a string when provided");
  const result = await getAdminService(c).reactivateUser(sessionUser.id, c.req.param("id"), typeof reason === "string" ? reason : undefined);
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.password");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const temporaryPasswordInput = (body as { temporary_password?: unknown }).temporary_password;
  if (temporaryPasswordInput !== undefined && typeof temporaryPasswordInput !== "string") return buildError(c, "VALIDATION_ERROR", "temporary_password must be a string when provided");
  const result = await getAdminService(c).resetPassword(sessionUser.id, c.req.param("id"), typeof temporaryPasswordInput === "string" ? temporaryPasswordInput : undefined);
  return result.ok ? c.json({ ok: true, ...result.data }) : buildError(c, result.code, result.message, result.details);
});

// Roles
adminRoutes.get("/roles", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.view");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).listRoles();
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.post("/roles", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = createRoleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role payload", parsed.error.flatten());
  const result = await getAdminService(c).createRole(sessionUser.id, { ...parsed.data, color: parsed.data.color ?? undefined });
  return result.ok ? c.json(result.data, 201) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/roles/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = updateRoleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role update payload", parsed.error.flatten());
  const result = await getAdminService(c).updateRole(sessionUser.id, c.req.param("id"), parsed.data);
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.delete("/roles/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).deleteRole(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message, result.details);
});

// Status
adminRoutes.get("/status", async (c) => {
  const sessionUser = await requirePermission(c, "admin.status.view", { freshPermissions: false });
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).getStatus();
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

// Analytics Settings
adminRoutes.get("/analytics-settings", async (c) => {
  const sessionUser = await requirePermission(c, "admin.analytics.view");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminService(c).getAnalyticsSettings();
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.patch("/analytics-settings", async (c) => {
  const sessionUser = await requirePermission(c, "admin.analytics.manage");
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = analyticsSettingsSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid analytics settings payload", parsed.error.flatten());
  const result = await getAdminService(c).updateAnalyticsSettings(sessionUser.id, parsed.data);
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

// Audit Archive
adminRoutes.get("/audit-archive/months", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.view");
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getAdminAuditService(c).listArchiveMonths();
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.get("/audit-archive/download", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.export");
  if (sessionUser instanceof Response) return sessionUser;
  const month = c.req.query("month");
  if (!month) return buildError(c, "VALIDATION_ERROR", "month query parameter required");
  const result = await getAdminAuditService(c).getArchiveDownloadLinks(sessionUser.id, month, (token) => buildArchiveDownloadUrl(c, token));
  return result.ok ? c.json(result.data) : buildError(c, result.code, result.message, result.details);
});

adminRoutes.get("/audit-archive/download/file", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.export");
  if (sessionUser instanceof Response) return sessionUser;
  const token = c.req.query("token");
  if (!token) return buildError(c, "VALIDATION_ERROR", "token query parameter required");
  const result = await getAdminAuditService(c).verifyAndGetArchiveFile(token);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return new Response(result.data.body, { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${result.data.filename}"` } });
});

// Audit Log
adminRoutes.get("/audit-log", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.view");
  if (sessionUser instanceof Response) return sessionUser;
  try {
    const result = await getAdminAuditService(c).listAuditLogs({
      entity_type: c.req.query("entity_type"),
      actor_id: c.req.query("actor_id"),
      search: c.req.query("search"),
      start_at: c.req.query("start_at"),
      end_at: c.req.query("end_at"),
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    return c.json(result);
  } catch (e) {
    if (e instanceof AuditLogQueryError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

adminRoutes.get("/audit-log/export", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.export");
  if (sessionUser instanceof Response) return sessionUser;
  try {
    const result = await getAdminAuditService(c).exportAuditLogs(sessionUser.id, {
      entity_type: c.req.query("entity_type"),
      actor_id: c.req.query("actor_id"),
      search: c.req.query("search"),
      start_at: c.req.query("start_at"),
      end_at: c.req.query("end_at"),
      format: c.req.query("format"),
    });
    return new Response(result.body, { headers: { "Content-Type": result.contentType, "Content-Disposition": `attachment; filename="${result.filename}"` } });
  } catch (e) {
    if (e instanceof AuditLogQueryError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

// Error Log
adminRoutes.get("/error-log", async (c) => {
  const sessionUser = await requirePermission(c, "admin.status.view");
  if (sessionUser instanceof Response) return sessionUser;

  const db = getDb(c);
  const pageRaw = Number.parseInt(c.req.query("page") ?? "", 10);
  const limitRaw = Number.parseInt(c.req.query("limit") ?? "", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
  const sourceFilter = c.req.query("source");

  const where = sourceFilter ? eq(errorLog.source, sourceFilter) : undefined;

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(errorLog)
    .where(where);

  const data = await db
    .select()
    .from(errorLog)
    .where(where)
    .orderBy(desc(errorLog.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({
    data,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
});
