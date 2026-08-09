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
import { MediaValidationError, parseImageMediaFormData } from "../services/MediaService";
import { buildAuditLogStatements } from "../services/audit";
import {
  buildError,
  getDb,
  handleResult,
  parseJsonBody,
  safeFormData,
} from "./_shared";
import { withMedia } from "./service-factory";

export const classRoutes = new Hono();

function getClassCatalogService(c: Context): ClassCatalogService {
  const env = c.env as Bindings;
  return new ClassCatalogService(getDb(c), {
    rawDb: env.DB,
    mediaService: withMedia(c).mediaService,
    generateId: () => nanoid(),
    buildAuditLogStatements: (input, condition) => (
      buildAuditLogStatements(c, input, condition)
    ),
  });
}

async function requireClassManagement(c: Context) {
  return requirePermission(c, "admin.classes.manage");
}

classRoutes.get("/", async (c) => {
  return handleResult(c, await getClassCatalogService(c).list());
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
  let uploads;
  try {
    uploads = await parseImageMediaFormData(form);
  } catch (error) {
    if (error instanceof MediaValidationError) return buildError(c, "VALIDATION_ERROR", error.message);
    throw error;
  }
  if (uploads.length !== 1) return buildError(c, "VALIDATION_ERROR", "Exactly one icon is required");
  const policy = await withMedia(c).getMediaPolicy();
  return handleResult(
    c,
    await getClassCatalogService(c).uploadIcon(c.req.param("id"), uploads[0]!, actor.id, policy.max_file_size_bytes.class_icon),
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
