import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@guild/shared";

const resolveSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../services/auth", () => ({
  resolveSession: resolveSessionMock,
}));

import { requirePermission } from "./rbac";

function appFor(required: readonly Permission[]) {
  const app = new Hono();
  app.get("/", async (context) => {
    const user = await requirePermission(context, required);
    return context.json({ id: user.id });
  });
  return app;
}

describe("requirePermission any-of authorization", () => {
  beforeEach(() => {
    resolveSessionMock.mockReset();
  });

  it("accepts a session with any one of the requested permissions", async () => {
    resolveSessionMock.mockResolvedValue({
      user: { id: "user-1", permissions: new Set<Permission>(["admin.invite.manage"]) },
    });

    const response = await appFor(["admin.roles.view", "admin.invite.manage"]).request("/");

    expect(response.status).toBe(200);
  });

  it("rejects a session that has none of the requested permissions", async () => {
    resolveSessionMock.mockResolvedValue({
      user: { id: "user-1", permissions: new Set<Permission>(["events.edit"]) },
    });

    const response = await appFor(["admin.roles.view", "admin.invite.manage"]).request("/");

    expect(response.status).toBe(403);
  });
});
