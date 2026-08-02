import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAppError } from "../middleware/error-handler";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  service: {
    updateCategory: vi.fn(),
    batchUpdateCategories: vi.fn(),
  },
}));

vi.mock("../middleware/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("../services/WikiService", () => ({
  WikiService: vi.fn(function WikiServiceMock() {
    return mocks.service;
  }),
}));

vi.mock("../services/audit", () => ({
  buildAuditLogStatements: vi.fn(() => []),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

import { wikiRoutes } from "./wiki";

function createApp() {
  const app = new Hono();
  app.route("/wiki", wikiRoutes);
  app.onError((error, c) => handleAppError(error, c));
  return app;
}

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue({
    id: "admin-1",
    permissions: new Set(["wiki.categories.manage"]),
  });
  mocks.service.updateCategory.mockReset().mockResolvedValue({ ok: true, data: {} });
  mocks.service.batchUpdateCategories.mockReset().mockResolvedValue({ ok: true, data: [] });
});

function batchRequest(body: unknown) {
  return createApp().request(
    "/wiki/categories/batch",
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
    { DB: {}, MEDIA: {} },
  );
}

describe("wiki category batch route", () => {
  /* "batch" 必须在 `/categories/:id` 之前注册，否则它会被当成一个 id 为 batch 的分类去改。
     这条断言盯的就是那个注册顺序，不是批量本身的逻辑。 */
  it("routes PATCH /categories/batch to the batch endpoint instead of updating a category named batch", async () => {
    const response = await batchRequest({ updates: [{ id: "guides", sort_order: 1 }] });

    expect(response.status).toBe(200);
    expect(mocks.service.batchUpdateCategories).toHaveBeenCalledWith("admin-1", [
      { id: "guides", sort_order: 1 },
    ]);
    expect(mocks.service.updateCategory).not.toHaveBeenCalled();
  });

  it("rejects a batch that lists the same category twice before it reaches the service", async () => {
    const response = await batchRequest({
      updates: [{ id: "guides", sort_order: 1 }, { id: "guides", sort_order: 2 }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(mocks.service.batchUpdateCategories).not.toHaveBeenCalled();
  });

  it("rejects a row that changes nothing", async () => {
    const response = await batchRequest({ updates: [{ id: "guides" }] });

    expect(response.status).toBe(400);
    expect(mocks.service.batchUpdateCategories).not.toHaveBeenCalled();
  });

  /* 空串会被 SQLite 当成一个真实的外键值写进 parent_id，必须在入口就拦住。 */
  it("rejects an empty-string parent instead of silently treating it as top level", async () => {
    const response = await batchRequest({ updates: [{ id: "guides", parent_id: "" }] });

    expect(response.status).toBe(400);
    expect(mocks.service.batchUpdateCategories).not.toHaveBeenCalled();
  });

  it("surfaces a nesting violation as 400 rather than swallowing it", async () => {
    mocks.service.batchUpdateCategories.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Category nesting supports only one level",
    });

    const response = await batchRequest({ updates: [{ id: "guides", parent_id: "root" }] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
  });

  it("guards the batch with wiki.categories.manage", async () => {
    await batchRequest({ updates: [{ id: "guides", sort_order: 1 }] });

    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "wiki.categories.manage",
    );
  });
});
