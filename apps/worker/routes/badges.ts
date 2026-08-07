import {
  createMemberBadgeSchema,
  reorderMemberBadgesSchema,
  updateMemberBadgeSchema,
  assignBadgeSchema,
  unassignBadgeSchema,
} from "@guild/shared";
import type { ReorderMemberBadgesInput } from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { BadgeService } from "../services/BadgeService";
import { getDb, handleResult, parseJsonBody } from "./_shared";
import { commonDeps } from "./service-factory";

export const badgeRoutes = new Hono();

function getService(c: Context): BadgeService {
  return new BadgeService(getDb(c), { ...commonDeps(c), rawDb: (c.env as Bindings).DB });
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
  const body = await parseJsonBody(c, createMemberBadgeSchema);
  const data = body as { name: string; label_html: string; color?: string; description?: string; sort_order?: number };
  const result = await getService(c).createBadge(sessionUser.id, data);
  return handleResult(c, result, 201);
});

/* 必须排在 `/:id` 之前：Hono 按注册顺序匹配，否则 "reorder" 会被当成一个徽章 id。
   职业目录那条路由（routes/classes.ts）踩过同一个坑，注释也在那边。 */
badgeRoutes.patch("/reorder", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  const input = await parseJsonBody(c, reorderMemberBadgesSchema) as ReorderMemberBadgesInput;
  return handleResult(c, await getService(c).reorderBadges(sessionUser.id, input.order));
});

badgeRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  const body = await parseJsonBody(c, updateMemberBadgeSchema);
  const data = body as { name?: string; label_html?: string; color?: string; description?: string; sort_order?: number };
  const result = await getService(c).updateBadge(sessionUser.id, c.req.param("id"), data);
  return handleResult(c, result);
});

badgeRoutes.delete("/:id", async (c) => {
  const sessionUser = await requirePermission(c, "admin.badges.manage");
  const result = await getService(c).deleteBadge(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

badgeRoutes.get("/:id/assignments", async (c) => {
  await requireBadgesManage(c);
  const result = await getService(c).listBadgeAssignments(c.req.param("id"));
  return handleResult(c, result);
});

badgeRoutes.post("/:id/assign", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  const body = await parseJsonBody(c, assignBadgeSchema);
  const { user_ids } = body as { user_ids: string[] };
  const result = await getService(c).assignBadge(sessionUser.id, c.req.param("id"), user_ids);
  return handleResult(c, result);
});

badgeRoutes.post("/:id/unassign", async (c) => {
  const sessionUser = await requireBadgesManage(c);
  const body = await parseJsonBody(c, unassignBadgeSchema);
  const { user_ids } = body as { user_ids: string[] };
  const result = await getService(c).unassignBadge(sessionUser.id, c.req.param("id"), user_ids);
  return handleResult(c, result);
});
