import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAppError } from "../middleware/error-handler";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  service: {
    list: vi.fn(),
    uploadIcon: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
  },
}));

vi.mock("../middleware/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("../services/ClassCatalogService", () => ({
  ClassCatalogService: vi.fn(function ClassCatalogServiceMock() {
    return mocks.service;
  }),
}));

vi.mock("../services/audit", () => ({
  buildAuditLogStatements: vi.fn(() => []),
}));

vi.mock("../services/media", () => ({
  deleteMediaObject: vi.fn(),
  storeClassIcon: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

import { classRoutes } from "./classes";

function createApp() {
  const app = new Hono();
  app.route("/classes", classRoutes);
  app.onError((error, c) => handleAppError(error, c));
  return app;
}

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue({
    id: "admin-1",
    permissions: new Set(["admin.classes.manage"]),
  });
  mocks.service.list.mockReset().mockResolvedValue({ ok: true, data: [] });
  mocks.service.uploadIcon.mockReset();
  mocks.service.update.mockReset().mockResolvedValue({ ok: true, data: {} });
  mocks.service.reorder.mockReset().mockResolvedValue({ ok: true, data: [] });
});

function reorderRequest(body: unknown) {
  return createApp().request(
    "/classes/reorder",
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
    { DB: {} },
  );
}

describe("class catalog routes", () => {
  it("keeps catalog reads public", async () => {
    const response = await createApp().request(
      "/classes",
      undefined,
      { DB: {} },
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("returns 400 for an explicit icon validation result", async () => {
    mocks.service.uploadIcon.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Class icons must be converted to WebP before upload",
    });
    const form = new FormData();
    form.set("file", new File(["png"], "class.png", { type: "image/png" }));

    const response = await createApp().request(
      "/classes/warden/icon",
      { method: "POST", body: form },
      { DB: {} },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
    });
  });

  /* "reorder" 必须在 `/:id` 之前注册，否则它会被当成一个叫 reorder 的职业去 update。
     这条断言盯的就是那个注册顺序，不是 reorder 本身的逻辑。 */
  it("routes PATCH /reorder to the batch endpoint instead of updating a class named reorder", async () => {
    const response = await reorderRequest({ order: ["warden", "seer"] });

    expect(response.status).toBe(200);
    expect(mocks.service.reorder).toHaveBeenCalledWith(["warden", "seer"], "admin-1");
    expect(mocks.service.update).not.toHaveBeenCalled();
  });

  it("rejects a reorder that lists the same class twice before it reaches the service", async () => {
    const response = await reorderRequest({ order: ["warden", "warden"] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(mocks.service.reorder).not.toHaveBeenCalled();
  });

  it("surfaces a stale-order conflict as 409 rather than swallowing it", async () => {
    mocks.service.reorder.mockResolvedValueOnce({
      ok: false,
      code: "CONFLICT",
      message: "Class order must list all 3 classes; received 2",
    });

    const response = await reorderRequest({ order: ["warden", "seer"] });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error_code: "CONFLICT" });
  });

  it("guards reorder with admin.classes.manage", async () => {
    await reorderRequest({ order: ["warden"] });

    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "admin.classes.manage",
    );
  });

  it.each([
    ["POST", "/classes"],
    ["PATCH", "/classes/reorder"],
    ["PATCH", "/classes/warden"],
    ["POST", "/classes/warden/icon"],
    ["DELETE", "/classes/warden/icon"],
    ["DELETE", "/classes/warden"],
  ] as const)("guards %s %s before any mutation", async (method, path) => {
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(403));

    const response = await createApp().request(path, { method }, { DB: {} });

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenLastCalledWith(
      expect.anything(),
      "admin.classes.manage",
    );
  });

  it("lets storage failures reach the global 500 path", async () => {
    mocks.service.uploadIcon.mockRejectedValueOnce(new Error("R2 unavailable"));
    const form = new FormData();
    form.set("file", new File(["RIFF____WEBP"], "class.webp", { type: "image/webp" }));

    const response = await createApp().request(
      "/classes/warden/icon",
      { method: "POST", body: form },
      { DB: {} },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error_code: "SERVER_ERROR",
      message: "Internal server error",
    });
  });
});
