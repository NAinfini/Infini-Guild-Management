import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  getDb: vi.fn(() => ({})),
  requireSessionUser: vi.fn().mockResolvedValue({
    id: "user-1",
    role: "member",
    roleId: "member",
    permissions: new Set(),
  }),
}));

vi.mock("./_shared", async (importOriginal) => ({
  ...await importOriginal<typeof import("./_shared")>(),
  getDb: routeMocks.getDb,
  requireSessionUser: routeMocks.requireSessionUser,
}));

vi.mock("./service-factory", () => ({
  withMedia: vi.fn(() => ({})),
}));

describe("storage item pagination validation", () => {
  beforeEach(() => {
    routeMocks.getDb.mockClear();
    routeMocks.requireSessionUser.mockClear();
  });

  it.each([
    "/items?stock=missing",
    "/items?limit=0",
    "/items?limit=101",
    "/items?limit=not-a-number",
    "/items?cursor=not%20base64url",
  ])("returns HTTP 400 for invalid query %s", async (path) => {
    const { storageRoutes } = await import("./storage");
    const response = await storageRoutes.request(
      path,
      { method: "GET" },
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(400);
  });
});
