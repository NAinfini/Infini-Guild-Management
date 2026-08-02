import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAppError } from "../middleware/error-handler";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  service: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../middleware/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("../services/ClassTagService", () => ({
  ClassTagService: vi.fn(function ClassTagServiceMock() {
    return mocks.service;
  }),
}));

vi.mock("../services/audit", () => ({
  buildAuditLogStatements: vi.fn(() => []),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

import { classTagRoutes } from "./class-tags";

function createApp() {
  const app = new Hono();
  app.route("/class-tags", classTagRoutes);
  app.onError((error, c) => handleAppError(error, c));
  return app;
}

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue({
    id: "admin-1",
    permissions: new Set(["admin.classes.manage"]),
  });
  mocks.service.list.mockReset().mockResolvedValue({ ok: true, data: [] });
  mocks.service.create.mockReset().mockResolvedValue({ ok: true, data: {} });
  mocks.service.update.mockReset().mockResolvedValue({ ok: true, data: {} });
  mocks.service.delete.mockReset().mockResolvedValue({ ok: true, data: { deleted: true } });
});

function post(body: unknown) {
  return createApp().request(
    "/class-tags",
    { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
    { DB: {} },
  );
}

function patch(id: string, body: unknown) {
  return createApp().request(
    `/class-tags/${id}`,
    { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
    { DB: {} },
  );
}

describe("class tag routes", () => {
  it("keeps tag reads public, same as the class catalog", async () => {
    // 成员要看懂卡片上的「治疗 1/2」就得知道标签叫什么，读取不能要权限。
    const response = await createApp().request("/class-tags", undefined, { DB: {} });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("guards every mutation with fresh admin.classes.manage permissions", async () => {
    await post({ label: "治疗" });
    await patch("tag-1", { label: "坦克" });
    await createApp().request("/class-tags/tag-1", { method: "DELETE" }, { DB: {} });

    expect(mocks.requirePermission).toHaveBeenCalledTimes(3);
    for (const call of mocks.requirePermission.mock.calls) {
      expect(call[1]).toBe("admin.classes.manage");
      expect(call[2]).toEqual({ freshPermissions: true });
    }
  });

  it("accepts a tag with no classes in it", async () => {
    /* 空标签是允许的——先把「治疗」这个格子占上、回头再往里放职业，是很自然的顺序。
       它会一路显示成配不齐，那正是该被看见的状态。 */
    const response = await post({ label: "治疗" });

    expect(response.status).toBe(201);
    expect(mocks.service.create).toHaveBeenCalledWith({ label: "治疗", class_ids: [] }, "admin-1");
  });

  it("accepts overlapping membership without complaint", async () => {
    // 破竹风同时进治疗和输出是合法的，这一层不替公会判断哪些职业算什么。
    await post({ label: "治疗", class_ids: ["牵丝霖", "破竹风"] });
    await post({ label: "输出", class_ids: ["破竹风", "鸣金虹"] });

    expect(mocks.service.create).toHaveBeenNthCalledWith(
      2,
      { label: "输出", class_ids: ["破竹风", "鸣金虹"] },
      "admin-1",
    );
  });

  it("rejects a tag that lists the same class twice before it reaches the service", async () => {
    const response = await post({ label: "治疗", class_ids: ["牵丝霖", "牵丝霖"] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(mocks.service.create).not.toHaveBeenCalled();
  });

  it("rejects an empty patch body instead of writing a no-op row", async () => {
    const response = await patch("tag-1", {});

    expect(response.status).toBe(400);
    expect(mocks.service.update).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate label as 409", async () => {
    mocks.service.create.mockResolvedValueOnce({
      ok: false,
      code: "CONFLICT",
      message: "A class tag with this label already exists",
    });

    const response = await post({ label: "治疗" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error_code: "CONFLICT" });
  });

  it("surfaces unknown class ids as 400 rather than dropping them", async () => {
    mocks.service.create.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Unknown class ids: ghost",
    });

    const response = await post({ label: "治疗", class_ids: ["ghost"] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "Unknown class ids: ghost" });
  });
});
