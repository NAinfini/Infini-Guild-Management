import type { IdentityAdminService } from "@guild/server/modules/auth";
import {
  adminUserLifecycleSchema,
  batchDeactivateSchema,
  batchRoleChangeSchema,
  createAdminMemberResponseSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  createRoleSchema,
  resetAdminPasswordSchema,
  resetAdminPasswordResponseSchema,
  roleAssignmentSchema,
  updateRoleSchema,
} from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { Hono } from "hono";
import type { RateLimiter } from "@guild/kernel";
import { z } from "zod";
import { clientIdentifier, requestContext, type HttpEnv } from "../../core/http-env.js";
import { consumeCredentialRateLimit } from "../../core/credential-rate-limit.js";
import { parseJsonBody, parseQuery } from "../../core/parsing.js";
import {
  presentInvite,
  presentInvitePage,
  presentLoginLock,
  presentResetLoginLock,
  presentRole,
} from "../../presenters/admin/admin-presenter.js";

const inviteQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(LIMITS.pagination.admin).default(LIMITS.pagination.admin),
  visibility: z.enum(["active", "expired", "revoked"]).default("active"),
  search: z.string().max(100).optional(),
}).strict();

type AdminHttpService = Pick<IdentityAdminService,
  | "listInvites" | "getInviteStats" | "createInvite" | "revokeInvite" | "deleteInvite"
  | "createMember" | "updateUserRole" | "setUserActive" | "resetPassword" | "getLoginLock" | "resetLoginLock"
  | "batchUpdateRole" | "batchDeactivate" | "batchReactivate" | "batchDelete"
  | "listRoles" | "createRole" | "updateRole" | "deleteRole"
>;

export type AdminRoutesDependencies = Readonly<{ service: AdminHttpService; rateLimiter: RateLimiter }>;

export function createAdminRoutes(dependencies: AdminRoutesDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/invite-links", async (context) => {
    const input = parseQuery(context.req.raw, inviteQuerySchema);
    return context.json(presentInvitePage(await dependencies.service.listInvites(requestContext(context), input)));
  });

  routes.get("/invite-links/stats", async (context) => context.json(
    await dependencies.service.getInviteStats(requestContext(context)),
  ));

  routes.post("/invite-links", async (context) => {
    const input = await parseJsonBody(context.req.raw, createInviteLinkSchema, "Invalid invite payload");
    return context.json(presentInvite(await dependencies.service.createInvite(requestContext(context), {
      roleId: input.role_id,
      maxUses: input.max_uses,
      expiresAt: input.expires_at ?? null,
    })), 201);
  });

  routes.delete("/invite-links/:id/permanent", async (context) => context.json(
    await dependencies.service.deleteInvite(requestContext(context), context.req.param("id")),
  ));

  routes.delete("/invite-links/:id", async (context) => context.json(
    await dependencies.service.revokeInvite(requestContext(context), context.req.param("id")),
  ));

  routes.post("/users", async (context) => {
    const input = await parseJsonBody(context.req.raw, createAdminMemberSchema, "Invalid member payload");
    const result = await dependencies.service.createMember(requestContext(context), {
      loginName: input.login_name,
      displayName: input.display_name,
      roleId: input.role_id,
    });
    return context.json(createAdminMemberResponseSchema.parse({
      ok: result.ok,
      user_id: result.userId,
      display_name: result.displayName,
      temporary_login_name: result.temporaryLoginName,
      temporary_password: result.temporaryPassword,
    }), 201);
  });

  routes.patch("/users/batch/role", async (context) => {
    const input = await parseJsonBody(context.req.raw, batchRoleChangeSchema, "Invalid batch role payload");
    return context.json(await dependencies.service.batchUpdateRole(
      requestContext(context), input.user_ids, input.new_role,
    ));
  });

  routes.patch("/users/batch/deactivate", async (context) => {
    const input = await parseJsonBody(context.req.raw, batchDeactivateSchema, "Invalid batch deactivate payload");
    return context.json(await dependencies.service.batchDeactivate(requestContext(context), input.user_ids));
  });

  routes.patch("/users/batch/reactivate", async (context) => {
    const input = await parseJsonBody(context.req.raw, batchDeactivateSchema, "Invalid batch reactivate payload");
    return context.json(await dependencies.service.batchReactivate(requestContext(context), input.user_ids));
  });

  routes.patch("/users/batch/delete", async (context) => {
    const input = await parseJsonBody(context.req.raw, batchDeactivateSchema, "Invalid batch delete payload");
    return context.json(await dependencies.service.batchDelete(requestContext(context), input.user_ids));
  });

  routes.patch("/users/:id/role", async (context) => {
    const input = await parseJsonBody(context.req.raw, roleAssignmentSchema, "Invalid role assignment payload");
    return context.json(await dependencies.service.updateUserRole(
      requestContext(context), context.req.param("id"), input.role,
    ));
  });

  routes.patch("/users/:id/deactivate", async (context) => {
    const input = await parseJsonBody(context.req.raw, adminUserLifecycleSchema, "Invalid deactivate payload");
    return context.json(await dependencies.service.setUserActive(
      requestContext(context), context.req.param("id"), false, input.reason,
    ));
  });

  routes.patch("/users/:id/reactivate", async (context) => {
    const input = await parseJsonBody(context.req.raw, adminUserLifecycleSchema, "Invalid reactivate payload");
    return context.json(await dependencies.service.setUserActive(
      requestContext(context), context.req.param("id"), true, input.reason,
    ));
  });

  routes.post("/users/:id/reset-password", async (context) => {
    const request = requestContext(context);
    const actor = request.authorization.requireAuthenticated();
    await consumeCredentialRateLimit(dependencies.rateLimiter, actor.userId, clientIdentifier(context));
    const input = await parseJsonBody(context.req.raw, resetAdminPasswordSchema, "Invalid password reset payload");
    const result = await dependencies.service.resetPassword(
      request, context.req.param("id"), input.current_password,
    );
    return context.json(resetAdminPasswordResponseSchema.parse({
      ok: true,
      temporary_login_name: result.temporaryLoginName,
      temporary_password: result.temporaryPassword,
    }));
  });

  routes.get("/users/:id/login-lock", async (context) => context.json(presentLoginLock(
    await dependencies.service.getLoginLock(requestContext(context), context.req.param("id")),
  )));

  routes.post("/users/:id/reset-login-lock", async (context) => {
    await parseJsonBody(context.req.raw, z.object({}).strict(), "Invalid login-lock reset payload");
    return context.json(presentResetLoginLock(await dependencies.service.resetLoginLock(
      requestContext(context), context.req.param("id"),
    )));
  });

  routes.get("/roles", async (context) => context.json(
    (await dependencies.service.listRoles(requestContext(context))).map(presentRole),
  ));

  routes.post("/roles", async (context) => {
    const input = await parseJsonBody(context.req.raw, createRoleSchema, "Invalid role payload");
    return context.json(presentRole(await dependencies.service.createRole(requestContext(context), input)), 201);
  });

  routes.patch("/roles/:id", async (context) => {
    const input = await parseJsonBody(context.req.raw, updateRoleSchema, "Invalid role update payload");
    return context.json(presentRole(await dependencies.service.updateRole(
      requestContext(context), context.req.param("id"), input,
    )));
  });

  routes.delete("/roles/:id", async (context) => context.json(
    await dependencies.service.deleteRole(requestContext(context), context.req.param("id")),
  ));

  return routes;
}
