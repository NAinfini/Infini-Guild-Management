import {
  createClassCatalogItemSchema,
  reorderClassCatalogSchema,
  updateClassCatalogItemSchema,
} from "@guild/shared";
import type { ReorderClassCatalogInput } from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { ClassCatalogService } from "../services/ClassCatalogService";
import { buildAuditLogStatements } from "../services/audit";
import { deleteMediaObject, storeClassIcon } from "../services/media";
import { createLogger } from "../utils/logger";
import {
  buildError,
  getDb,
  handleResult,
  parseJsonBody,
  safeFormData,
  serveR2Object,
} from "./_shared";

export const classRoutes = new Hono();

function getClassCatalogService(c: Context): ClassCatalogService {
  const env = c.env as Bindings;
  const log = createLogger(c.get("requestId") as string | undefined);
  return new ClassCatalogService(getDb(c), {
    rawDb: env.DB,
    generateId: () => nanoid(),
    storeIcon: (classId, file) => storeClassIcon(c, classId, file),
    deleteObject: (key) => deleteMediaObject(c, key),
    buildAuditLogStatements: (input, condition) => (
      buildAuditLogStatements(c, input, condition)
    ),
    warn: (message, context) => log.warn(message, context),
  });
}

async function requireClassManagement(c: Context) {
  return requirePermission(c, "admin.classes.manage");
}

classRoutes.get("/", async (c) => {
  return handleResult(c, await getClassCatalogService(c).list());
});

classRoutes.get("/icon", async (c) => {
  const key = c.req.query("key");
  if (!key) return buildError(c, "VALIDATION_ERROR", "key query parameter required");
  const service = getClassCatalogService(c);
  if (!await service.referencesIcon(key)) {
    return buildError(c, "NOT_FOUND", "Class icon not found");
  }
  return serveR2Object(c, key, "Class icon not found");
});

classRoutes.post("/", async (c) => {
  const actor = await requireClassManagement(c);
  const input = await parseJsonBody(c, createClassCatalogItemSchema);
  return handleResult(
    c,
    await getClassCatalogService(c).create(
      input as Parameters<ClassCatalogService["create"]>[0],
      actor.id,
    ),
    201,
  );
});

/* 必须排在 `/:id` 之前：Hono 按注册顺序匹配，否则 "reorder" 会被当成一个职业 id。 */
classRoutes.patch("/reorder", async (c) => {
  const actor = await requireClassManagement(c);
  const input = await parseJsonBody(c, reorderClassCatalogSchema) as ReorderClassCatalogInput;
  return handleResult(
    c,
    await getClassCatalogService(c).reorder(input.order, actor.id),
  );
});

classRoutes.patch("/:id", async (c) => {
  const actor = await requireClassManagement(c);
  const input = await parseJsonBody(c, updateClassCatalogItemSchema);
  return handleResult(
    c,
    await getClassCatalogService(c).update(
      c.req.param("id"),
      input as Parameters<ClassCatalogService["update"]>[1],
      actor.id,
    ),
  );
});

classRoutes.post("/:id/icon", async (c) => {
  const actor = await requireClassManagement(c);
  const form = await safeFormData(c);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return buildError(c, "VALIDATION_ERROR", "file is required");
  }
  return handleResult(
    c,
    await getClassCatalogService(c).uploadIcon(c.req.param("id"), file, actor.id),
  );
});

classRoutes.delete("/:id/icon", async (c) => {
  const actor = await requireClassManagement(c);
  return handleResult(
    c,
    await getClassCatalogService(c).removeIcon(c.req.param("id"), actor.id),
  );
});

classRoutes.delete("/:id", async (c) => {
  const actor = await requireClassManagement(c);
  return handleResult(
    c,
    await getClassCatalogService(c).delete(c.req.param("id"), actor.id),
  );
});
