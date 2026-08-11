import type { RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import type { ImageUpload } from "@guild/server/modules/media";
import type { StorageService } from "@guild/server/modules/storage";
import { Hono } from "hono";
import { z } from "zod";
import { parseFormData, parseJsonBody, type ParsedMultipartForm } from "../../core/parsing.js";
import {
  presentStorage,
  presentStorageBatch,
  presentStorageCategory,
  presentStorageItem,
  presentStorageItems,
  presentStorageMediaIds,
  presentStorageOk,
  presentStorageTransaction,
  presentStorageTransactions,
  presentStorageTree,
} from "../../presenters/storage/storage-presenter.js";

type StorageHttpEnv = {
  Variables: {
    requestContext: RequestContext;
  };
};

export type StorageRouteDependencies = Readonly<{
  service: StorageService;
  parseImageFormData(form: ParsedMultipartForm): Promise<readonly ImageUpload[]>;
}>;

export function createStorageRoutes(dependencies: StorageRouteDependencies): Hono<StorageHttpEnv> {
  const routes = new Hono<StorageHttpEnv>();
  const requestContext = (context: { get(key: "requestContext"): RequestContext }) => context.get("requestContext");

  routes.get("/", async (context) => context.json(
    presentStorageTree(await dependencies.service.getTree(requestContext(context))),
  ));

  routes.post("/storages", async (context) => {
    const storage = await dependencies.service.createStorage(requestContext(context), await jsonBody(context.req.raw));
    return context.json(presentStorage(storage), 201);
  });

  routes.patch("/storages/:id", async (context) => {
    const storage = await dependencies.service.updateStorage(
      requestContext(context),
      context.req.param("id"),
      await jsonBody(context.req.raw),
    );
    return context.json(presentStorage(storage));
  });

  routes.delete("/storages/:id", async (context) => {
    const result = await dependencies.service.deleteStorage(requestContext(context), context.req.param("id"));
    return context.json(presentStorageOk(result));
  });

  routes.post("/storages/:storageId/categories", async (context) => {
    const category = await dependencies.service.createCategory(
      requestContext(context),
      context.req.param("storageId"),
      await jsonBody(context.req.raw),
    );
    return context.json(presentStorageCategory(category), 201);
  });

  routes.patch("/storages/:storageId/categories/:id", async (context) => {
    const category = await dependencies.service.updateCategory(
      requestContext(context),
      context.req.param("storageId"),
      context.req.param("id"),
      await jsonBody(context.req.raw),
    );
    return context.json(presentStorageCategory(category));
  });

  routes.delete("/storages/:storageId/categories/:id", async (context) => {
    const result = await dependencies.service.deleteCategory(
      requestContext(context),
      context.req.param("storageId"),
      context.req.param("id"),
    );
    return context.json(presentStorageOk(result));
  });

  routes.get("/transactions", async (context) => context.json(presentStorageTransactions(
    await dependencies.service.listTransactions(requestContext(context), {
      item_id: context.req.query("item_id"),
      recipient_user_id: context.req.query("recipient_user_id"),
      page: context.req.query("page"),
      limit: context.req.query("limit"),
    }),
  )));

  routes.post("/transactions/batch", async (context) => {
    const result = await dependencies.service.createBatchTransaction(
      requestContext(context),
      await jsonBody(context.req.raw),
    );
    return context.json(presentStorageBatch(result), 201);
  });

  routes.get("/items", async (context) => context.json(presentStorageItems(
    await dependencies.service.listItems(requestContext(context), {
      storage_id: context.req.query("storage_id"),
      category_id: context.req.query("category_id"),
      search: context.req.query("search"),
      stock: context.req.query("stock"),
      limit: context.req.query("limit"),
      cursor: context.req.query("cursor"),
    }),
  )));

  routes.post("/items", async (context) => {
    const item = await dependencies.service.createItem(requestContext(context), await jsonBody(context.req.raw));
    return context.json(presentStorageItem(item), 201);
  });

  routes.get("/items/:id", async (context) => context.json(presentStorageItem(
    await dependencies.service.getItem(requestContext(context), context.req.param("id")),
  )));

  routes.patch("/items/:id", async (context) => {
    const item = await dependencies.service.updateItem(
      requestContext(context),
      context.req.param("id"),
      await jsonBody(context.req.raw),
    );
    return context.json(presentStorageItem(item));
  });

  routes.delete("/items/:id", async (context) => {
    const result = await dependencies.service.deleteItem(requestContext(context), context.req.param("id"));
    return context.json(presentStorageOk(result));
  });

  routes.post("/items/:id/images", async (context) => {
    let form: ParsedMultipartForm;
    try {
      form = await parseFormData(context.req.raw);
    } catch (cause) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid or missing form data", cause });
    }
    const mediaIds = await dependencies.service.uploadImages(
      requestContext(context),
      context.req.param("id"),
      await dependencies.parseImageFormData(form),
    );
    return context.json(presentStorageMediaIds(mediaIds), 201);
  });

  routes.delete("/items/:id/images/:mediaId", async (context) => {
    const result = await dependencies.service.deleteImage(
      requestContext(context),
      context.req.param("id"),
      context.req.param("mediaId"),
    );
    return context.json(presentStorageOk(result));
  });

  routes.post("/items/:id/transactions", async (context) => {
    const transaction = await dependencies.service.createTransaction(
      requestContext(context),
      context.req.param("id"),
      await jsonBody(context.req.raw),
    );
    return context.json(presentStorageTransaction(transaction), 201);
  });

  return routes;
}

async function jsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(request, z.unknown(), "Invalid JSON body");
}
