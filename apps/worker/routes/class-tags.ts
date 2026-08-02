import { createClassTagSchema, updateClassTagSchema } from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { ClassTagService } from "../services/ClassTagService";
import { buildAuditLogStatements } from "../services/audit";
import { getDb, handleResult, parseJsonBody } from "./_shared";

export const classTagRoutes = new Hono();

function getClassTagService(c: Context): ClassTagService {
  const env = c.env as Bindings;
  return new ClassTagService(getDb(c), {
    rawDb: env.DB,
    generateId: () => nanoid(),
    buildAuditLogStatements: (input, condition) => buildAuditLogStatements(c, input, condition),
  });
}

/* 标签跟职业目录是同一件事的两面，共用同一个权限；改动照样要求刷新权限缓存。 */
async function requireClassManagement(c: Context) {
  return requirePermission(c, "admin.classes.manage", { freshPermissions: true });
}

classTagRoutes.get("/", async (c) => {
  return handleResult(c, await getClassTagService(c).list());
});

classTagRoutes.post("/", async (c) => {
  const actor = await requireClassManagement(c);
  const input = await parseJsonBody(c, createClassTagSchema);
  return handleResult(
    c,
    await getClassTagService(c).create(input as Parameters<ClassTagService["create"]>[0], actor.id),
    201,
  );
});

classTagRoutes.patch("/:id", async (c) => {
  const actor = await requireClassManagement(c);
  const input = await parseJsonBody(c, updateClassTagSchema);
  return handleResult(
    c,
    await getClassTagService(c).update(
      c.req.param("id"),
      input as Parameters<ClassTagService["update"]>[1],
      actor.id,
    ),
  );
});

classTagRoutes.delete("/:id", async (c) => {
  const actor = await requireClassManagement(c);
  return handleResult(c, await getClassTagService(c).delete(c.req.param("id"), actor.id));
});
