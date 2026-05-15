import {
  createMemberBadgeSchema,
  updateMemberBadgeSchema,
  assignBadgeSchema,
  unassignBadgeSchema,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { BadgeService } from "../services/BadgeService";
import { handleResult, parseJsonBody } from "./_shared";

export const badgeRoutes = new Hono();

function getService(c: Context): BadgeService {
  const env = c.env as Bindings;
  return new BadgeService(drizzle(env.DB), {
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
  });
}

async function requireBadgesManage(c: Context) {
  return requirePermission(c, "admin.badges.manage");
}

badgeRoutes.get("/", async (c) => {
  const result = await getService(c).listBadges();
  return handleResult(c, result);
});

badgeRoutes.get("/:id", async (c) => {
  const result = await getService(c).getBadge(c.req.param("id"));
  return handleResult(c, result);
});

badgeRoutes.post("/", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c, createMemberBadgeSchema);
  if (body instanceof Response) return body;
  const data = body as { name: string; label_html: string; color?: string; description?: string; sort_order?: number };
  const result = await getService(c).createBadge(sessionUser.id, data);
  return handleResult(c, result, 201);
});

badgeRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c, updateMemberBadgeSchema);
  if (body instanceof Response) return body;
  const data = body as { name?: string; label_html?: string; color?: string; description?: string; sort_order?: number };
  const result = await getService(c).updateBadge(sessionUser.id, c.req.param("id"), data);
  return handleResult(c, result);
});

badgeRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).deleteBadge(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

badgeRoutes.get("/:id/assignments", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).listBadgeAssignments(c.req.param("id"));
  return handleResult(c, result);
});

badgeRoutes.post("/:id/assign", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c, assignBadgeSchema);
  if (body instanceof Response) return body;
  const { user_ids } = body as { user_ids: string[] };
  const result = await getService(c).assignBadge(sessionUser.id, c.req.param("id"), user_ids);
  return handleResult(c, result);
});

badgeRoutes.post("/:id/unassign", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c, unassignBadgeSchema);
  if (body instanceof Response) return body;
  const { user_ids } = body as { user_ids: string[] };
  const result = await getService(c).unassignBadge(sessionUser.id, c.req.param("id"), user_ids);
  return handleResult(c, result);
});
