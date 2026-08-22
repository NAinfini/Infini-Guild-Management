import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { InviteRecord, RoleRecord } from "@guild/server/modules/auth";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createAdminRoutes } from "./admin-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const role: RoleRecord = {
  id: "member", name: "Member", level: 100, color: null,
  permissions: new Set(["events.create"]), assignedUserCount: 2,
  revisionToken: "role-v1", createdAt: NOW, updatedAt: NOW,
};
const invite: InviteRecord & { code: string } = {
  id: "invite-1", code: "A1b2C3d4E5", createdBy: "admin-1", roleId: "member", roleName: "Member",
  roleColor: null, roleLevel: 100, maxUses: 5, usedCount: 1, expiresAt: null, createdAt: NOW, revokedAt: null,
};

function buildApp() {
  const service = {
    listInvites: vi.fn().mockResolvedValue({ data: [invite], nextCursor: "next", total: 1 }),
    getInviteStats: vi.fn().mockResolvedValue({ total: 1, active: 1, revoked: 0, expired: 0 }),
    createInvite: vi.fn().mockResolvedValue(invite),
    revokeInvite: vi.fn().mockResolvedValue({ ok: true as const }),
    deleteInvite: vi.fn().mockResolvedValue({ ok: true as const }),
    createMember: vi.fn().mockResolvedValue({
      ok: true as const, userId: "user-2", username: "NewMember", temporaryPassword: "temporary-password",
    }),
    updateUserRole: vi.fn().mockResolvedValue({ ok: true as const }),
    setUserActive: vi.fn().mockResolvedValue({ ok: true as const }),
    resetPassword: vi.fn().mockResolvedValue({ ok: true as const, temporaryPassword: "temporary-password" }),
    getLoginLock: vi.fn().mockResolvedValue({
      failCount: 6, lockedUntil: "2026-08-09T12:05:00.000Z", isLocked: true, retryAfterSeconds: 300,
    }),
    resetLoginLock: vi.fn().mockResolvedValue({
      ok: true as const, failCount: 6, lockedUntil: "2026-08-09T12:05:00.000Z",
      isLocked: true, retryAfterSeconds: 300,
    }),
    batchUpdateRole: vi.fn().mockResolvedValue({ ok: true as const, updated: 1 }),
    batchDeactivate: vi.fn().mockResolvedValue({ ok: true as const, updated: 1 }),
    batchReactivate: vi.fn().mockResolvedValue({ ok: true as const, updated: 1 }),
    batchDelete: vi.fn().mockResolvedValue({ ok: true as const, updated: 1 }),
    listRoles: vi.fn().mockResolvedValue([role]),
    createRole: vi.fn().mockResolvedValue(role),
    updateRole: vi.fn().mockResolvedValue(role),
    deleteRole: vi.fn().mockResolvedValue({ ok: true as const }),
  };
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1", now: NOW,
      authorization: createAuthorizationContext({
        userId: "admin-1", sessionId: "session-1", roleId: "admin", roleLevel: 900, permissions: [],
      }),
    }));
    await next();
  });
  app.route("/api/admin", createAdminRoutes({ service }));
  return { app, service };
}

describe("admin identity Portal HTTP contract", () => {
  it("presents invites and roles in snake_case without persistence metadata", async () => {
    const { app, service } = buildApp();
    const invites = await app.request("/api/admin/invite-links?visibility=active&limit=25&cursor=current&search=member");
    expect(await invites.json()).toEqual({
      data: [{
        id: "invite-1", code: "A1b2C3d4E5", created_by: "admin-1", role_id: "member",
        role_name: "Member", role_color: null, role_level: 100, max_uses: 5, used_count: 1,
        expires_at: null, created_at: NOW, revoked_at: null,
      }],
      next_cursor: "next",
      total: 1,
    });
    expect(service.listInvites).toHaveBeenCalledWith(expect.anything(), {
      visibility: "active", limit: 25, cursor: "current", search: "member",
    });
    const roles = await app.request("/api/admin/roles");
    expect(await roles.json()).toEqual([expect.objectContaining({
      id: "member", assigned_user_count: 2, created_at: NOW, updated_at: NOW,
    })]);
  });

  it("keeps every invite, user-management, batch, and role path", async () => {
    const { app } = buildApp();
    const requests: Array<readonly [string, string, BodyInit | undefined, number]> = [
      ["GET", "/api/admin/invite-links/stats", undefined, 200],
      ["POST", "/api/admin/invite-links", json({ role_id: "member", max_uses: 5 }), 201],
      ["DELETE", "/api/admin/invite-links/invite-1", undefined, 200],
      ["DELETE", "/api/admin/invite-links/invite-1/permanent", undefined, 200],
      ["POST", "/api/admin/users", json({ username: "NewMember", role_id: "member" }), 201],
      ["PATCH", "/api/admin/users/user-2/role", json({ role: "member" }), 200],
      ["PATCH", "/api/admin/users/user-2/deactivate", json({ reason: "Away" }), 200],
      ["PATCH", "/api/admin/users/user-2/reactivate", json({}), 200],
      ["POST", "/api/admin/users/user-2/reset-password", json({ temporary_password: "temporary-password" }), 200],
      ["GET", "/api/admin/users/user-2/login-lock", undefined, 200],
      ["POST", "/api/admin/users/user-2/reset-login-lock", json({}), 200],
      ["PATCH", "/api/admin/users/batch/role", json({ user_ids: ["user-2"], new_role: "member" }), 200],
      ["PATCH", "/api/admin/users/batch/deactivate", json({ user_ids: ["user-2"] }), 200],
      ["PATCH", "/api/admin/users/batch/reactivate", json({ user_ids: ["user-2"] }), 200],
      ["PATCH", "/api/admin/users/batch/delete", json({ user_ids: ["user-2"] }), 200],
      ["POST", "/api/admin/roles", json({ id: "custom", name: "Custom", level: 50 }), 201],
      ["PATCH", "/api/admin/roles/member", json({ name: "Members" }), 200],
      ["DELETE", "/api/admin/roles/member", undefined, 200],
    ];
    for (const [method, path, body, status] of requests) {
      const response = await app.request(path, {
        method, body,
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
      });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    }
  });

  it("maps create/reset response field names to the Portal contract", async () => {
    const { app } = buildApp();
    const created = await app.request("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "NewMember", role_id: "member" }),
    });
    expect(await created.json()).toEqual({
      ok: true, user_id: "user-2", username: "NewMember", temporary_password: "temporary-password",
    });
    const reset = await app.request("/api/admin/users/user-2/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(await reset.json()).toEqual({ ok: true, temporary_password: "temporary-password" });

    const lock = await app.request("/api/admin/users/user-2/login-lock");
    expect(await lock.json()).toEqual({
      fail_count: 6,
      locked_until: "2026-08-09T12:05:00.000Z",
      is_locked: true,
      retry_after_seconds: 300,
    });
    const lockReset = await app.request("/api/admin/users/user-2/reset-login-lock", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(await lockReset.json()).toEqual({
      ok: true,
      fail_count: 6,
      locked_until: "2026-08-09T12:05:00.000Z",
      is_locked: true,
      retry_after_seconds: 300,
    });
  });
});

function json(value: unknown): string {
  return JSON.stringify(value);
}
