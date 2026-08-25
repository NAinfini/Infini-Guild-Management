import { createAuthorizationContext, createRequestContext, type RequestContext } from "@guild/kernel";
import type { StorageService } from "@guild/server/modules/storage";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createStorageRoutes } from "./storage-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const MEDIA_ID = "storageimage000000001";
const item = {
  id: "item-1",
  storage_id: "storage-1",
  category_id: "category-1",
  name: "Potion",
  description: null,
  quantity: 1.5,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images: [{ media_id: MEDIA_ID }],
  created_at: NOW,
  updated_at: NOW,
};
const transaction = {
  id: "transaction-1",
  item_id: item.id,
  item_name: item.name,
  type: "intake" as const,
  quantity_delta: 0.5,
  recipient_user_id: "user-1",
  recipient_display_name: "member",
  note: null,
  actor_id: "user-1",
  actor_display_name: "member",
  created_at: NOW,
};
const storage = {
  id: "storage-1",
  name: "Guild Vault",
  description: null,
  created_at: NOW,
  categories: [{ id: "category-1", name: "Supplies" }],
};
function buildApp() {
  const service = {
    getTree: vi.fn().mockResolvedValue({ data: [storage] }),
    createStorage: vi.fn().mockResolvedValue(storage),
    updateStorage: vi.fn().mockResolvedValue(storage),
    deleteStorage: vi.fn().mockResolvedValue({ ok: true as const }),
    createCategory: vi.fn().mockResolvedValue(storage.categories[0]!),
    updateCategory: vi.fn().mockResolvedValue(storage.categories[0]!),
    deleteCategory: vi.fn().mockResolvedValue({ ok: true as const }),
    listTransactions: vi.fn().mockResolvedValue({ data: [transaction], total: 1, page: 2, limit: 25, total_pages: 1 }),
    createBatchTransaction: vi.fn().mockResolvedValue({ data: [transaction], replayed: false }),
    listItems: vi.fn().mockResolvedValue({ data: [item], next_cursor: "next" }),
    createItem: vi.fn().mockResolvedValue(item),
    getItem: vi.fn().mockResolvedValue(item),
    updateItem: vi.fn().mockResolvedValue(item),
    deleteItem: vi.fn().mockResolvedValue({ ok: true as const }),
    uploadImages: vi.fn().mockResolvedValue([{ media_id: MEDIA_ID }]),
    deleteImage: vi.fn().mockResolvedValue({ ok: true as const }),
    createTransaction: vi.fn().mockResolvedValue(transaction),
  } as unknown as StorageService;
  const parseImageFormData = vi.fn().mockResolvedValue([{ full: new Uint8Array(), view: new Uint8Array() }]);
  const app = new Hono<{ Variables: { requestContext: RequestContext } }>();
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      authorization: createAuthorizationContext({
        userId: "user-1",
        sessionId: "session-1",
        roleId: "member",
        roleLevel: 100,
        permissions: [],
      }),
      now: NOW,
    }));
    await next();
  });
  app.route("/api/storage", createStorageRoutes({
    service,
    parseImageFormData,
  }));
  return { app, service, parseImageFormData };
}

describe("storage Portal HTTP contract", () => {
  it("keeps every existing route and response status", async () => {
    const { app } = buildApp();
    const form = new FormData();
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    const requests: Array<[string, string, BodyInit | undefined, number]> = [
      ["GET", "/api/storage", undefined, 200],
      ["POST", "/api/storage/storages", json({ name: "Guild Vault" }), 201],
      ["PATCH", "/api/storage/storages/storage-1", json({ name: "Guild Vault" }), 200],
      ["DELETE", "/api/storage/storages/storage-1", undefined, 200],
      ["POST", "/api/storage/storages/storage-1/categories", json({ name: "Supplies" }), 201],
      ["PATCH", "/api/storage/storages/storage-1/categories/category-1", json({ name: "Supplies" }), 200],
      ["DELETE", "/api/storage/storages/storage-1/categories/category-1", undefined, 200],
      ["GET", "/api/storage/transactions?page=2&limit=25&recipient_user_id=me", undefined, 200],
      ["POST", "/api/storage/transactions/batch", json({}), 201],
      ["GET", "/api/storage/items?storage_id=storage-1&stock=all&limit=24&cursor=current", undefined, 200],
      ["POST", "/api/storage/items", json({}), 201],
      ["GET", "/api/storage/items/item-1", undefined, 200],
      ["PATCH", "/api/storage/items/item-1", json({}), 200],
      ["DELETE", "/api/storage/items/item-1", undefined, 200],
      ["POST", "/api/storage/items/item-1/images", form, 201],
      ["DELETE", `/api/storage/items/item-1/images/${MEDIA_ID}`, undefined, 200],
      ["POST", "/api/storage/items/item-1/transactions", json({}), 201],
    ];

    for (const [method, path, body, expected] of requests) {
      const response = await app.request(path, { method, body, ...(typeof body === "string" ? {
        headers: { "Content-Type": "application/json" },
      } : {}) });
      expect(response.status, `${method} ${path}`).toBe(expected);
    }
  });

  it("preserves page/cursor query names, multipart media IDs, and public invalidation hints", async () => {
    const { app, service, parseImageFormData } = buildApp();
    await app.request("/api/storage/transactions?item_id=item-1&recipient_user_id=me&page=2&limit=25");
    expect(service.listTransactions).toHaveBeenCalledWith(expect.anything(), {
      item_id: "item-1",
      recipient_user_id: "me",
      page: "2",
      limit: "25",
    });
    await app.request("/api/storage/items?storage_id=storage-1&category_id=category-1&search=pot&stock=available&limit=24&cursor=next");
    expect(service.listItems).toHaveBeenCalledWith(expect.anything(), {
      storage_id: "storage-1",
      category_id: "category-1",
      search: "pot",
      stock: "available",
      limit: "24",
      cursor: "next",
    });

    const form = new FormData();
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    const response = await app.request("/api/storage/items/item-1/images", { method: "POST", body: form });
    expect(await response.json()).toEqual([{ media_id: MEDIA_ID }]);
    expect(parseImageFormData).toHaveBeenCalledOnce();
  });
});

function json(value: unknown): string {
  return JSON.stringify(value);
}
