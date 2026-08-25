import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { ClassCatalogItem, ClassTag, MemberBadge } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createBadgeRoutes, createClassRoutes, createClassTagRoutes } from "./members-catalog-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const catalogClass: ClassCatalogItem = {
  id: "class-1", label: "Sword", color: "#123456", sort_order: 0,
  icon_type: "vector", vector_icon: "sword", icon_media_id: null, created_at: NOW, updated_at: NOW,
};
const tag: ClassTag = {
  id: "tag-1", label: "Damage", class_ids: ["class-1"], sort_order: 0, usage_count: 1,
  created_at: NOW, updated_at: NOW,
};
const badge: MemberBadge = {
  id: "badge-1", name: "Founder", label_html: "<b>Founder</b>", color: "#fff",
  description: null, sort_order: 0, created_at: NOW, updated_at: NOW,
};

function buildApp() {
  const service = {
    listClasses: vi.fn().mockResolvedValue([catalogClass]),
    getClass: vi.fn().mockResolvedValue(catalogClass),
    createClass: vi.fn().mockResolvedValue(catalogClass),
    updateClass: vi.fn().mockResolvedValue(catalogClass),
    reorderClasses: vi.fn().mockResolvedValue([catalogClass]),
    uploadClassIcon: vi.fn().mockResolvedValue({
      ...catalogClass,
      icon_type: "image",
      vector_icon: null,
      icon_media_id: "class-icon-0000000000",
    }),
    deleteClassIcon: vi.fn().mockResolvedValue(catalogClass),
    deleteClass: vi.fn().mockResolvedValue({ deleted: true as const }),
    listClassTags: vi.fn().mockResolvedValue([tag]),
    createClassTag: vi.fn().mockResolvedValue(tag),
    getClassTag: vi.fn().mockResolvedValue(tag),
    updateClassTag: vi.fn().mockResolvedValue(tag),
    reorderClassTags: vi.fn().mockResolvedValue([tag]),
    deleteClassTag: vi.fn().mockResolvedValue({ deleted: true as const }),
    listBadges: vi.fn().mockResolvedValue([badge]),
    getBadge: vi.fn().mockResolvedValue(badge),
    createBadge: vi.fn().mockResolvedValue(badge),
    updateBadge: vi.fn().mockResolvedValue(badge),
    reorderBadges: vi.fn().mockResolvedValue([badge]),
    deleteBadge: vi.fn().mockResolvedValue({ ok: true as const }),
    listBadgeAssignments: vi.fn().mockResolvedValue({
      data: [{
        badgeId: "badge-1", userId: "user-1", display_name: "Member", assignedBy: "admin-1",
        assignedByUsername: "Admin", assignedAt: NOW,
      }],
      next_cursor: "next",
    }),
    assignBadge: vi.fn().mockResolvedValue({ assigned: 1 }),
    unassignBadge: vi.fn().mockResolvedValue({ removed: 1 }),
  };
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1", now: NOW,
      authorization: createAuthorizationContext({
        userId: "admin-1", sessionId: "session-1", roleId: "admin", roleLevel: 900, permissions: [],
      }),
    }));
    await next();
  });
  app.route("/api/classes", createClassRoutes({ service }));
  app.route("/api/class-tags", createClassTagRoutes({ service }));
  app.route("/api/badges", createBadgeRoutes({ service }));
  return { app, service };
}

describe("member catalog Portal HTTP contract", () => {
  it("keeps every class, class-tag, and badge path", async () => {
    const { app } = buildApp();
    const requests: Array<readonly [string, string, BodyInit | undefined, number]> = [
      ["GET", "/api/classes", undefined, 200],
      ["POST", "/api/classes", json({ label: "Sword", color: "#123456", vector_icon: "sword" }), 201],
      ["GET", "/api/classes/class-1", undefined, 200],
      ["PATCH", "/api/classes/class-1", json({ label: "Sword" }), 200],
      ["PATCH", "/api/classes/reorder", json({ order: ["class-1"] }), 200],
      ["POST", "/api/classes/class-1/icon", imageForm(), 201],
      ["DELETE", "/api/classes/class-1/icon", undefined, 200],
      ["DELETE", "/api/classes/class-1", undefined, 200],
      ["GET", "/api/class-tags", undefined, 200],
      ["POST", "/api/class-tags", json({ label: "Damage", class_ids: ["class-1"] }), 201],
      ["GET", "/api/class-tags/tag-1", undefined, 200],
      ["PATCH", "/api/class-tags/tag-1", json({ label: "Damage" }), 200],
      ["PATCH", "/api/class-tags/reorder", json({ order: ["tag-1"] }), 200],
      ["DELETE", "/api/class-tags/tag-1", undefined, 200],
      ["GET", "/api/badges", undefined, 200],
      ["POST", "/api/badges", json({ name: "Founder", label_html: "Founder" }), 201],
      ["GET", "/api/badges/badge-1", undefined, 200],
      ["PATCH", "/api/badges/badge-1", json({ name: "Founder" }), 200],
      ["PATCH", "/api/badges/reorder", json({ order: ["badge-1"] }), 200],
      ["GET", "/api/badges/badge-1/assignments", undefined, 200],
      ["POST", "/api/badges/badge-1/assign", json({ user_ids: ["user-1"] }), 200],
      ["POST", "/api/badges/badge-1/unassign", json({ user_ids: ["user-1"] }), 200],
      ["DELETE", "/api/badges/badge-1", undefined, 200],
    ];
    for (const [method, path, body, status] of requests) {
      const response = await app.request(path, {
        method, body,
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
      });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    }
  });

  it("presents assignment records with snake_case fields", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/badges/badge-1/assignments");
    expect(await response.json()).toEqual({
      data: [{
        badge_id: "badge-1", user_id: "user-1", display_name: "Member", assigned_by: "admin-1",
        assigned_by_display_name: "Admin", assigned_at: NOW,
      }],
      next_cursor: "next",
    });
  });

  it("rejects a malformed catalog response at the HTTP boundary", async () => {
    const { app, service } = buildApp();
    service.listBadges.mockResolvedValue([{ ...badge, color: "blue" }]);
    const response = await app.request("/api/badges");
    expect(response.status).toBe(500);
  });
});

function json(value: unknown): string {
  return JSON.stringify(value);
}

function imageForm(): FormData {
  const form = new FormData();
  form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
  form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
  return form;
}
