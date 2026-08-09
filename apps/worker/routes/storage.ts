import { storageItemsListQuerySchema, type Permission } from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { MediaValidationError, parseImageMediaFormData } from "../services/MediaService";
import { StorageService } from "../services/StorageService";
import { buildError, getDb, handleResult, parseJsonBody, requireSessionUser, safeFormData, throwError } from "./_shared";
import { withMedia } from "./service-factory";

export const storageRoutes = new Hono();

function getService(c: Context): StorageService {
  const env = c.env as Bindings;
  return new StorageService(getDb(c), { ...withMedia(c), rawDb: env.DB });
}

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "50", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 50;
}

async function requireStoragePermission(c: Context, permission: Permission) {
  const user = await requireSessionUser(c);
  if (!user.permissions.has(permission)) {
    throwError(c, "FORBIDDEN", "Insufficient permission");
  }
  return user;
}

async function requireStorageStructureManager(c: Context) {
  return requireStoragePermission(c, "admin.storage.structure");
}

async function requireStorageItemManager(c: Context) {
  return requireStoragePermission(c, "admin.storage.items");
}

storageRoutes.get("/", async (c) => {
  await requireSessionUser(c);
  return handleResult(c, await getService(c).getTree());
});

storageRoutes.post("/storages", async (c) => {
  const user = await requireStorageStructureManager(c);
  return handleResult(c, await getService(c).createStorage(user.id, await parseJsonBody(c)), 201);
});

storageRoutes.patch("/storages/:id", async (c) => {
  const user = await requireStorageStructureManager(c);
  return handleResult(c, await getService(c).updateStorage(user.id, c.req.param("id"), await parseJsonBody(c)));
});

storageRoutes.delete("/storages/:id", async (c) => {
  const user = await requireStorageStructureManager(c);
  return handleResult(c, await getService(c).deleteStorage(user.id, c.req.param("id")));
});

storageRoutes.post("/storages/:storageId/categories", async (c) => {
  const user = await requireStorageStructureManager(c);
  return handleResult(c, await getService(c).createCategory(user.id, c.req.param("storageId"), await parseJsonBody(c)), 201);
});

storageRoutes.patch("/storages/:storageId/categories/:id", async (c) => {
  const user = await requireStorageStructureManager(c);
  return handleResult(c, await getService(c).updateCategory(user.id, c.req.param("storageId"), c.req.param("id"), await parseJsonBody(c)));
});

storageRoutes.delete("/storages/:storageId/categories/:id", async (c) => {
  const user = await requireStorageStructureManager(c);
  return handleResult(c, await getService(c).deleteCategory(user.id, c.req.param("storageId"), c.req.param("id")));
});

storageRoutes.get("/transactions", async (c) => {
  const user = await requireSessionUser(c);
  const recipient = c.req.query("recipient_user_id");
  const recipientUserId = recipient === "me" ? user.id : recipient;
  return handleResult(c, await getService(c).listTransactions({
    itemId: c.req.query("item_id"),
    recipientUserId,
    page: parsePage(c.req.query("page")),
    limit: parseLimit(c.req.query("limit")),
  }));
});

storageRoutes.post("/transactions/batch", async (c) => {
  const user = await requireSessionUser(c);
  return handleResult(c, await getService(c).applyBatchTransactions(user, await parseJsonBody(c)), 201);
});

storageRoutes.get("/items", async (c) => {
  await requireSessionUser(c);
  const parsed = storageItemsListQuerySchema.safeParse({
    storage_id: c.req.query("storage_id"),
    category_id: c.req.query("category_id"),
    search: c.req.query("search"),
    stock: c.req.query("stock"),
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid storage item query", parsed.error.flatten());
  return handleResult(c, await getService(c).listItems({
    storageId: parsed.data.storage_id,
    categoryId: parsed.data.category_id,
    search: parsed.data.search,
    stock: parsed.data.stock,
    limit: parsed.data.limit,
    cursor: parsed.data.cursor,
  }));
});

storageRoutes.post("/items", async (c) => {
  const user = await requireStorageItemManager(c);
  return handleResult(c, await getService(c).createItem(user.id, await parseJsonBody(c)), 201);
});

storageRoutes.get("/items/:id", async (c) => {
  await requireSessionUser(c);
  return handleResult(c, await getService(c).getItem(c.req.param("id")));
});

storageRoutes.patch("/items/:id", async (c) => {
  const user = await requireStorageItemManager(c);
  return handleResult(c, await getService(c).updateItem(user.id, c.req.param("id"), await parseJsonBody(c)));
});

storageRoutes.delete("/items/:id", async (c) => {
  const user = await requireStorageItemManager(c);
  return handleResult(c, await getService(c).deleteItem(user.id, c.req.param("id")));
});

storageRoutes.post("/items/:id/images", async (c) => {
  const user = await requireStorageItemManager(c);
  const form = await safeFormData(c);
  let uploads;
  try {
    uploads = await parseImageMediaFormData(form);
  } catch (error) {
    if (error instanceof MediaValidationError) return buildError(c, "VALIDATION_ERROR", error.message);
    throw error;
  }
  const mediaPolicy = await withMedia(c).getMediaPolicy();
  const maxImageBytes = mediaPolicy.max_file_size_bytes.storage_image;
  return handleResult(c, await getService(c).uploadImages(user.id, c.req.param("id"), uploads, maxImageBytes), 201);
});

storageRoutes.delete("/items/:id/images/:mediaId", async (c) => {
  const user = await requireStorageItemManager(c);
  return handleResult(c, await getService(c).deleteImage(user.id, c.req.param("id"), c.req.param("mediaId")));
});

storageRoutes.post("/items/:id/transactions", async (c) => {
  const user = await requireSessionUser(c);
  return handleResult(c, await getService(c).applyTransaction(user, c.req.param("id"), await parseJsonBody(c)), 201);
});
