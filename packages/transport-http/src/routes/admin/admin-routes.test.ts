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
const invite: InviteRecord = {
  id: "invite-1", code: "A1B2C3D4E5", createdBy: "admin-1", roleId: "member", roleName: "Member",
  roleColor: null, roleLevel: 100, maxUses: 5, usedCount: 1, expiresAt: null, createdAt: NOW, revokedAt: null,
};

function buildApp() {
  const rateLimiter = {
    consume: vi.fn().mockResolvedValue({ allowed: true as const }),
  };
  const service = {
    listInvites: vi.fn().mockResolvedValue({ data: [invite], nextCursor: "next", total: 1 }),
    getInviteStats: vi.fn().mockResolvedValue({ total: 1, active: 1, revoked: 0, expired: 0 }),
    createInvite: vi.fn().mockResolvedValue(invite),
    revokeInvite: vi.fn().mockResolvedValue({ ok: true as const }),
    deleteInvite: vi.fn().mockResolvedValue({ ok: true as const }),
    createMember: vi.fn().mockResolvedValue({
      ok: true as const,
      userId: "user-2",
      displayName: "New_Member",
      temporaryLoginName: "new_member",
      temporaryPassword: "temporary-password",
    }),
    updateMember: vi.fn().mockResolvedValue({
      ok: true as const,
      user_revision_token: "user-v2",
      profile_revision_token: "profile-v2",
    }),
    updateUserRole: vi.fn().mockResolvedValue({ ok: true as const }),
    setUserActive: vi.fn().mockResolvedValue({ ok: true as const }),
    resetPassword: vi.fn().mockResolvedValue({
      ok: true as const,
      temporaryLoginName: "recovery_member",
      temporaryPassword: "temporary-password",
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
    context.set("clientIdentifier", "198.51.100.5");
    await next();
  });
  app.route("/api/admin", createAdminRoutes({ service, rateLimiter }));
  return { app, service, rateLimiter };
}

describe("admin identity Portal HTTP contract", () => {
  it("presents invites and roles in snake_case without persistence metadata", async () => {
    const { app, service } = buildApp();
    const invites = await app.request("/api/admin/invite-links?visibility=active&limit=25&cursor=current&search=member");
    const listed = await invites.json();
    expect(listed).toEqual({
      data: [{
        id: "invite-1", code: "A1B2C3D4E5", created_by: "admin-1", role_id: "member",
        role_name: "Member", role_color: null, role_level: 100, max_uses: 5, used_count: 1,
        expires_at: null, created_at: NOW, revoked_at: null,
      }],
      next_cursor: "next",
      total: 1,
    });
    expect(service.listInvites).toHaveBeenCalledWith(expect.anything(), {
      visibility: "active", limit: 25, cursor: "current", search: "member",
    });
    const created = await app.request("/api/admin/invite-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ role_id: "member", max_uses: 5 }),
    });
    expect(await created.json()).toEqual(expect.objectContaining({
      id: "invite-1",
      code: "A1B2C3D4E5",
    }));
    const roles = await app.request("/api/admin/roles");
    expect(await roles.json()).toEqual([expect.objectContaining({
      id: "member", assigned_user_count: 2, created_at: NOW, updated_at: NOW,
      revision_token: "role-v1",
    })]);
  });

  it("keeps every invite, user-management, batch, and role path", async () => {
    const { app, service } = buildApp();
    const requests: Array<readonly [string, string, BodyInit | undefined, number]> = [
      ["GET", "/api/admin/invite-links/stats", undefined, 200],
      ["POST", "/api/admin/invite-links", json({ role_id: "member", max_uses: 5 }), 201],
      ["DELETE", "/api/admin/invite-links/invite-1", undefined, 200],
      ["DELETE", "/api/admin/invite-links/invite-1/permanent", undefined, 200],
      ["POST", "/api/admin/users", json({ login_name: "new_member", display_name: "New_Member", role_id: "member" }), 201],
      ["PATCH", "/api/admin/users/user-2", json({
        expected_user_revision_token: "user-v1",
        expected_profile_revision_token: "profile-v1",
        display_name: "RenamedMember",
        profile: {
          power: 42, classes: ["guardian"], title_html: null, bio: null, availability: null, notes: "Officer note",
        },
        role_id: "member", is_active: true,
      }), 200],
      ["PATCH", "/api/admin/users/user-2/role", json({ role: "member" }), 200],
      ["PATCH", "/api/admin/users/user-2/deactivate", json({ reason: "Away" }), 200],
      ["PATCH", "/api/admin/users/user-2/reactivate", json({}), 200],
      ["POST", "/api/admin/users/user-2/reset-password", json({ current_password: "admin-password" }), 200],
      ["PATCH", "/api/admin/users/batch/role", json({ user_ids: ["user-2"], new_role: "member" }), 200],
      ["PATCH", "/api/admin/users/batch/deactivate", json({ user_ids: ["user-2"] }), 200],
      ["PATCH", "/api/admin/users/batch/reactivate", json({ user_ids: ["user-2"] }), 200],
      ["PATCH", "/api/admin/users/batch/delete", json({ user_ids: ["user-2"] }), 200],
      ["POST", "/api/admin/roles", json({ id: "custom", name: "Custom", level: 50 }), 201],
      ["PATCH", "/api/admin/roles/member", json({ expected_revision_token: "role-v1", name: "Members" }), 200],
      ["DELETE", "/api/admin/roles/member", undefined, 200],
    ];
    for (const [method, path, body, status] of requests) {
      const response = await app.request(path, {
        method, body,
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
      });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    }
    expect(service.updateMember).toHaveBeenCalledWith(expect.anything(), "user-2", {
      expectedUserRevisionToken: "user-v1",
      expectedProfileRevisionToken: "profile-v1",
      displayName: "RenamedMember",
      profile: {
        power: 42,
        classes: ["guardian"],
        titleHtml: null,
        bio: null,
        availability: null,
        notes: "Officer note",
      },
      roleId: "member",
      isActive: true,
    });
  });

  it("does not expose account lock inspection or reset routes", async () => {
    const { app } = buildApp();
    const inspect = await app.request("/api/admin/users/user-2/login-lock");
    const reset = await app.request("/api/admin/users/user-2/reset-login-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(inspect.status).toBe(404);
    expect(reset.status).toBe(404);
  });

  it("rejects fields outside the atomic member-edit contract before dispatch", async () => {
    const { app, service } = buildApp();
    const response = await app.request("/api/admin/users/user-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_user_revision_token: "user-v1",
        expected_profile_revision_token: "profile-v1",
        profile: {
          power: 42,
          classes: [],
          title_html: null,
          bio: null,
          availability: null,
          notes: null,
          display_name: "Escalation attempt",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(service.updateMember).not.toHaveBeenCalled();
  });

  it("maps create/reset response field names to the Portal contract", async () => {
    const { app, service, rateLimiter } = buildApp();
    const created = await app.request("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login_name: "new_member",
        display_name: "New_Member",
        role_id: "member",
        notes: "Initial officer note",
      }),
    });
    expect(await created.json()).toEqual({
      ok: true,
      user_id: "user-2",
      display_name: "New_Member",
      temporary_login_name: "new_member",
      temporary_password: "temporary-password",
    });
    expect(service.createMember).toHaveBeenCalledWith(expect.anything(), {
      loginName: "new_member",
      displayName: "New_Member",
      roleId: "member",
      notes: "Initial officer note",
    });
    const reset = await app.request("/api/admin/users/user-2/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: "admin-password" }),
    });
    expect(await reset.json()).toEqual({
      ok: true,
      temporary_login_name: "recovery_member",
      temporary_password: "temporary-password",
    });
    expect(rateLimiter.consume.mock.calls).toEqual([
      ["auth:credential:user:admin-1"],
      ["auth:credential:source:198.51.100.5"],
    ]);
  });
});

function json(value: unknown): string {
  return JSON.stringify(value);
}
