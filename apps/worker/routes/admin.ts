import {
  analyticsSettingsSchema,
  batchDeactivateSchema,
  batchRoleChangeSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  createRoleSchema,
  updateRoleSchema,
  updateSiteConfigSchema,
} from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { desc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { customAlphabet, nanoid } from "nanoid";
import { z } from "zod";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog, writeAuditLogDurable } from "../services/audit";
import { AdminService, type MediaLike } from "../services/AdminService";
import { AdminAuditService, AuditLogQueryError } from "../services/AdminAuditService";
import { createPasswordHash } from "../services/auth";
import { errorLog } from "../db/schema/error-log";
import { buildError, getDb, handleResult, parseJsonBody, parsePage } from "./_shared";
import { getSiteConfigService } from "./site-config";
import { SystemTestService, getSystemTestRunId } from "../services/SystemTestService";
import { SYSTEM_TEST_RUN_ID_HEADER } from "@guild/shared/config/system-test";

const generateInviteCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 16);
const generateTemporaryPassword = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", 12);

export const adminRoutes = new Hono();

const systemTestSummarySchema = z.object({
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  errors: z.array(z.object({
    category: z.string().max(120),
    label: z.string().max(160),
    method: z.string().max(12),
    path: z.string().max(500),
    status: z.number().int().nullable(),
    error: z.string().max(500).nullable(),
  })).max(100),
});

export function areSystemTestsEnabled(
  env: Pick<Bindings, "ENVIRONMENT" | "ENABLE_PRODUCTION_SYSTEM_TESTS">,
): boolean {
  return env.ENVIRONMENT !== "production" || env.ENABLE_PRODUCTION_SYSTEM_TESTS === "true";
}

function rejectDisabledSystemTests(c: Context): Response | null {
  if (areSystemTestsEnabled(c.env as Bindings)) return null;
  return buildError(c, "NOT_FOUND", "Not found");
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
    envSiteName: env.SITE_NAME,
    envSiteLogoUrl: env.SITE_LOGO_URL,
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
    signingSecret: env.SIGNING_SECRET,
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
  const canManage = sessionUser.permissions.has("admin.invite.manage");
  const cursor = c.req.query("cursor");
  const limitRaw = Number.parseInt(c.req.query("limit") ?? "", 10);
  const visibilityRaw = c.req.query("visibility");
  const visibility = visibilityRaw === "expired" || visibilityRaw === "revoked"
    ? visibilityRaw
    : "active";
  const search = (c.req.query("search") ?? "").trim().slice(0, 200);
  const result = await getAdminService(c).listInviteLinks({
    cursor: cursor && cursor.length > 0 ? cursor : undefined,
    limit: Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 100)
      : LIMITS.pagination.admin,
    visibility,
    search: search || undefined,
    searchCodes: canManage,
  });
  if (!result.ok) return handleResult(c, result);
  const data = canManage
    ? result.data.data
    : (result.data.data as Record<string, unknown>[]).map(({ code: _, ...rest }) => ({
        ...rest,
        code: "••••••••••••••••",
      }));
  return c.json({ ...result.data, data });
});

adminRoutes.get("/invite-links/stats", async (c) => {
  await requirePermission(c, "admin.invite.view");
  const result = await getAdminService(c).getInviteLinkStats();
  return handleResult(c, result);
});

adminRoutes.post("/invite-links", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.manage");
  const body = await parseJsonBody(c);
  const parsed = createInviteLinkSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid invite payload", parsed.error.flatten());
  const result = await getAdminService(c).createInviteLink(sessionUser.id, parsed.data.max_uses, parsed.data.expires_at ?? null);
  return handleResult(c, result, 201);
});

adminRoutes.delete("/invite-links/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.manage");
  const result = await getAdminService(c).revokeInviteLink(sessionUser.id, c.req.param("id"));
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true });
});

adminRoutes.delete("/invite-links/:id/permanent", async (c) => {
  const sessionUser = await requirePermission(c, "admin.invite.manage");
  const result = await getAdminService(c).deleteInviteLink(sessionUser.id, c.req.param("id"));
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true });
});

// User Management
adminRoutes.patch("/users/batch/role", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.role", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const parsed = batchRoleChangeSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch role payload", parsed.error.flatten());
  const result = await getAdminService(c).batchUpdateRole(sessionUser.id, parsed.data.user_ids, parsed.data.new_role);
  return handleResult(c, result);
});

adminRoutes.patch("/users/batch/deactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  const body = await parseJsonBody(c);
  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch deactivate payload", parsed.error.flatten());
  const result = await getAdminService(c).batchDeactivate(sessionUser.id, parsed.data.user_ids);
  return handleResult(c, result);
});

adminRoutes.patch("/users/batch/reactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  const body = await parseJsonBody(c);
  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch reactivate payload", parsed.error.flatten());
  const result = await getAdminService(c).batchReactivate(sessionUser.id, parsed.data.user_ids);
  return handleResult(c, result);
});

adminRoutes.patch("/users/batch/delete", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.delete", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const parsed = batchDeactivateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid batch delete payload", parsed.error.flatten());
  const result = await getAdminService(c).batchDelete(sessionUser.id, parsed.data.user_ids);
  return handleResult(c, result);
});

adminRoutes.post("/users", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.edit");
  const body = await parseJsonBody(c);
  const parsed = createAdminMemberSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid create member payload", parsed.error.flatten());
  const result = await getAdminService(c).createMember(sessionUser.id, parsed.data.username);
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true, ...result.data }, 201);
});

adminRoutes.patch("/users/:id/role", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.role", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const parsed = batchRoleChangeSchema.shape.new_role.safeParse((body as { role?: unknown }).role);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role payload", parsed.error.flatten());
  const result = await getAdminService(c).updateUserRole(sessionUser.id, c.req.param("id"), parsed.data);
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true });
});

adminRoutes.patch("/users/:id/deactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  const body = await parseJsonBody(c);
  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") return buildError(c, "VALIDATION_ERROR", "reason must be a string when provided");
  const result = await getAdminService(c).deactivateUser(sessionUser.id, c.req.param("id"), typeof reason === "string" ? reason : undefined);
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true });
});

adminRoutes.patch("/users/:id/reactivate", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.activate");
  const body = await parseJsonBody(c);
  const reason = (body as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") return buildError(c, "VALIDATION_ERROR", "reason must be a string when provided");
  const result = await getAdminService(c).reactivateUser(sessionUser.id, c.req.param("id"), typeof reason === "string" ? reason : undefined);
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.password", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const temporaryPasswordInput = (body as { temporary_password?: unknown }).temporary_password;
  if (temporaryPasswordInput !== undefined && typeof temporaryPasswordInput !== "string") return buildError(c, "VALIDATION_ERROR", "temporary_password must be a string when provided");
  const result = await getAdminService(c).resetPassword(sessionUser.id, c.req.param("id"), typeof temporaryPasswordInput === "string" ? temporaryPasswordInput : undefined);
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true, ...result.data });
});

adminRoutes.post("/users/:id/reset-login-lock", async (c) => {
  const sessionUser = await requirePermission(c, "admin.users.password", { freshPermissions: true });
  const result = await getAdminService(c).resetLoginLock(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

// Roles
adminRoutes.get("/roles", async (c) => {
  await requirePermission(c, "admin.roles.view");
  const result = await getAdminService(c).listRoles();
  return handleResult(c, result);
});

adminRoutes.post("/roles", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const parsed = createRoleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role payload", parsed.error.flatten());
  const result = await getAdminService(c).createRole(sessionUser.id, { ...parsed.data, color: parsed.data.color ?? undefined });
  return handleResult(c, result, 201);
});

adminRoutes.patch("/roles/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const parsed = updateRoleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role update payload", parsed.error.flatten());
  const result = await getAdminService(c).updateRole(sessionUser.id, c.req.param("id"), parsed.data);
  return handleResult(c, result);
});

adminRoutes.delete("/roles/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage", { freshPermissions: true });
  const result = await getAdminService(c).deleteRole(sessionUser.id, c.req.param("id"));
  if (!result.ok) return handleResult(c, result);
  return c.json({ ok: true });
});

// Status
adminRoutes.get("/site-config", async (c) => {
  await requirePermission(c, "admin.siteConfig.manage");
  return handleResult(c, await getSiteConfigService(c).getAdminConfig());
});

adminRoutes.patch("/site-config", async (c) => {
  const sessionUser = await requirePermission(c, "admin.siteConfig.manage", { freshPermissions: true });
  const body = await parseJsonBody(c);
  const parsed = updateSiteConfigSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid site config payload", parsed.error.flatten());
  return handleResult(c, await getSiteConfigService(c).updateAdminConfig(sessionUser.id, parsed.data));
});

adminRoutes.post("/site-config/logo", async (c) => {
  const sessionUser = await requirePermission(c, "admin.siteConfig.manage", { freshPermissions: true });
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Request must be multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return buildError(c, "VALIDATION_ERROR", "Logo file is required");
  return handleResult(c, await getSiteConfigService(c).uploadSiteLogo(sessionUser.id, file));
});

adminRoutes.get("/status", async (c) => {
  await requirePermission(c, "admin.status.view", { freshPermissions: false });
  const result = await getAdminService(c).getStatus();
  if (!result.ok) return handleResult(c, result);
  return c.json({
    ...result.data,
    system_tests_enabled: areSystemTestsEnabled(c.env as Bindings),
  });
});

adminRoutes.post("/status/system-test-runs", async (c) => {
  const disabledResponse = rejectDisabledSystemTests(c);
  if (disabledResponse) return disabledResponse;
  const sessionUser = await requirePermission(c, "admin.status.view", { freshPermissions: false });
  const runId = await new SystemTestService(c.env as Bindings).createRun(sessionUser.id);
  return c.json({ run_id: runId, fixture_id: crypto.randomUUID() }, 201);
});

adminRoutes.post("/status/system-test-runs/:runId/cleanup", async (c) => {
  const disabledResponse = rejectDisabledSystemTests(c);
  if (disabledResponse) return disabledResponse;
  const sessionUser = await requirePermission(c, "admin.status.view", { freshPermissions: false });
  try {
    const result = await new SystemTestService(c.env as Bindings).cleanupRun(c.req.param("runId"), sessionUser.id);
    return c.json({ ok: result.status === "completed", ...result }, result.status === "completed" ? 200 : 409);
  } catch (error) {
    return buildError(c, "FORBIDDEN", error instanceof Error ? error.message : "System test cleanup denied");
  }
});

adminRoutes.post("/status/system-test-runs/:runId/finalize", async (c) => {
  const disabledResponse = rejectDisabledSystemTests(c);
  if (disabledResponse) return disabledResponse;
  const sessionUser = await requirePermission(c, "admin.status.view", { freshPermissions: false });
  try {
    await new SystemTestService(c.env as Bindings).finalizeRun(c.req.param("runId"), sessionUser.id);
    return c.json({ ok: true });
  } catch (error) {
    return buildError(c, "CONFLICT", error instanceof Error ? error.message : "System test run is not ready to finalize");
  }
});

adminRoutes.post("/status/system-test-audit", async (c) => {
  const disabledResponse = rejectDisabledSystemTests(c);
  if (disabledResponse) return disabledResponse;
  const sessionUser = await requirePermission(c, "admin.status.view", { freshPermissions: false });
  const runId = c.req.header(SYSTEM_TEST_RUN_ID_HEADER) ?? getSystemTestRunId(c);
  if (!runId) return buildError(c, "FORBIDDEN", "A valid active system-test run is required");
  if (!(await new SystemTestService(c.env as Bindings).isRunOwnedBy(runId, sessionUser.id))) {
    return buildError(c, "FORBIDDEN", "System test run belongs to another actor");
  }
  const parsed = systemTestSummarySchema.safeParse(await parseJsonBody(c));
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid system test summary", parsed.error.flatten());
  const { total, passed, failed, errors } = parsed.data;
  await new SystemTestService(c.env as Bindings).finalizeRun(runId, sessionUser.id, {
    diffTitle: `Full system test: ${passed}/${total} passed`,
    detailText: JSON.stringify({ total, passed, failed, errors }),
  });
  return c.json({ ok: true });
});

// Analytics Settings
adminRoutes.get("/analytics-settings", async (c) => {
  await requirePermission(c, "admin.analytics.view");
  const result = await getAdminService(c).getAnalyticsSettings();
  return handleResult(c, result);
});

adminRoutes.patch("/analytics-settings", async (c) => {
  const sessionUser = await requirePermission(c, "admin.analytics.manage");
  const body = await parseJsonBody(c);
  const parsed = analyticsSettingsSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid analytics settings payload", parsed.error.flatten());
  const result = await getAdminService(c).updateAnalyticsSettings(sessionUser.id, parsed.data);
  return handleResult(c, result);
});

// Audit Archive
adminRoutes.get("/audit-archive/months", async (c) => {
  await requirePermission(c, "admin.audit.view");
  const result = await getAdminAuditService(c).listArchiveMonths();
  return handleResult(c, result);
});

adminRoutes.get("/audit-archive/download", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.export");
  const month = c.req.query("month");
  if (!month) return buildError(c, "VALIDATION_ERROR", "month query parameter required");
  const result = await getAdminAuditService(c).getArchiveDownloadLinks(sessionUser.id, month, (token) => buildArchiveDownloadUrl(c, token));
  return handleResult(c, result);
});

adminRoutes.get("/audit-archive/download/file", async (c) => {
  const sessionUser = await requirePermission(c, "admin.audit.export");
  const token = c.req.query("token");
  if (!token) return buildError(c, "VALIDATION_ERROR", "token query parameter required");
  const result = await getAdminAuditService(c).verifyAndGetArchiveFile(token, sessionUser.id);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return new Response(result.data.body, { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${result.data.filename}"` } });
});

// Audit Log
adminRoutes.get("/audit-log", async (c) => {
  await requirePermission(c, "admin.audit.view");
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
  await requirePermission(c, "admin.status.view");

  const db = getDb(c);
  const page = parsePage(c.req.query("page"), 1);
  const limitRaw = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
  const sourceFilter = c.req.query("source");

  const where = sourceFilter ? eq(errorLog.source, sourceFilter) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(errorLog)
    .where(where);
  const total = countRow?.count ?? 0;

  const data = await db
    .select()
    .from(errorLog)
    .where(where)
    .orderBy(desc(errorLog.createdAt), desc(errorLog.id))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({
    data,
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});
