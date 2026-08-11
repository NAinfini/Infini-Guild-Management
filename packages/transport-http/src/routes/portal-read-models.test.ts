import {
  createAuthorizationContext,
  createRequestContext,
  type RequestContext,
} from "@guild/kernel";
import {
  AdminStatusService,
  PortalReadModelService,
  type PortalReadModelStore,
} from "@guild/server/modules/portal-read-models";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../core/error-handler.js";
import type { HttpEnv } from "../core/http-env.js";
import { createAdminStatusRoutes } from "./admin-status/admin-status-routes.js";
import { createDashboardRoutes } from "./dashboard/dashboard-routes.js";
import { createSearchRoutes } from "./search/search-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";

function app(permissions: readonly string[] = [], authenticated = true) {
  const value = new Hono<HttpEnv>();
  value.onError(createHttpErrorHandler());
  value.use("*", async (context, next) => {
    context.set("requestContext", request(permissions, authenticated));
    await next();
  });
  return value;
}

function request(permissions: readonly string[], authenticated = true): RequestContext {
  return createRequestContext({
    requestId: "request-1",
    now: NOW,
    authorization: createAuthorizationContext(authenticated ? {
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions,
    } : null),
  });
}

function store(overrides: Partial<PortalReadModelStore> = {}): PortalReadModelStore {
  return {
    dashboardMembers: vi.fn().mockResolvedValue({ activeMemberCount: 3, totalMemberCount: 4 }),
    dashboardEvents: vi.fn().mockResolvedValue({
      activeEventCount: 0,
      featuredEvents: [],
      upcomingEvents: [],
      mySignupEventIds: [],
    }),
    dashboardWars: vi.fn().mockResolvedValue({ allWarWinRate: 50, recentWars: [], recentWarMvps: [] }),
    search: vi.fn().mockResolvedValue([{
      id: "user-1",
      title: "Alice",
      subtitle: "Member",
      type: "user",
      to: "/roster",
      entityId: "user-1",
      roleId: "member",
      roleName: "Member",
      roleColor: null,
      roleLevel: 100,
    }]),
    ...overrides,
  };
}

describe("Portal read-model HTTP routes", () => {
  it("keeps the dashboard and search Portal paths and snake_case responses", async () => {
    const value = app();
    const service = new PortalReadModelService(store());
    value.route("/api/dashboard", createDashboardRoutes({ service }));
    value.route("/api/search", createSearchRoutes({ service }));

    expect(await (await value.request("/api/dashboard/members")).json()).toEqual({
      active_member_count: 3,
      total_member_count: 4,
    });
    expect(await (await value.request("/api/dashboard/events?external_view=true")).json()).toEqual({
      active_events_count: 0,
      featured_events: [],
      upcoming_events: [],
      my_signup_event_ids: [],
    });
    expect(await (await value.request("/api/dashboard/wars")).json()).toEqual({
      all_war_win_rate: 50,
      recent_wars: [],
      recent_war_mvps: [],
    });
    expect(await (await value.request("/api/search?q=ali&limit=5")).json()).toEqual({
      data: [expect.objectContaining({
        id: "user-1",
        entity_id: "user-1",
        role_name: "Member",
        role_level: 100,
      })],
    });
  });

  it("keeps /api/admin/status permissioned and maps platform-neutral health names", async () => {
    const health = { read: vi.fn().mockResolvedValue({
      database: "ok",
      blob: "configured",
      realtime: "ok",
      scheduler: "ok",
    }) };
    const denied = app();
    denied.route("/api/admin/status", createAdminStatusRoutes({ service: new AdminStatusService(health) }));
    expect((await denied.request("/api/admin/status")).status).toBe(403);

    const allowed = app(["admin.status.view"]);
    allowed.route("/api/admin/status", createAdminStatusRoutes({ service: new AdminStatusService(health) }));
    expect(await (await allowed.request("/api/admin/status")).json()).toEqual({
      db: "ok",
      r2: "configured",
      ws: "ok",
      crons: "ok",
    });
  });

  it("defaults guests to the external war DTO and keeps internal fields for authenticated viewers", async () => {
    const dashboardWars = vi.fn().mockResolvedValue({
      allWarWinRate: 100,
      recentWars: [{
        id: "war-1",
        eventId: "event-1",
        status: "concluded",
        warName: "Final",
        enemyName: "Rivals",
        result: "win",
        ownStats: { kills: 10, towers: null, base_hp: null, credits: null, distance: null },
        enemyStats: null,
        durationMinutes: 30,
        notes: "private note",
        createdBy: "admin-1",
        updatedBy: "admin-2",
        createdAt: NOW,
        updatedAt: NOW,
        rosterVersion: 1,
        concludedAt: NOW,
      }],
      recentWarMvps: [[{
        category: "damage",
        label: "damage",
        name: "Secret Player",
        initials: "SP",
        value: 999,
      }]],
    });
    const service = new PortalReadModelService(store({ dashboardWars }));
    const guest = app([], false);
    guest.route("/api/dashboard", createDashboardRoutes({ service }));
    const publicBody = await (await guest.request("/api/dashboard/wars")).json() as Record<string, unknown>;
    expect(Object.keys(publicBody)).toEqual(["all_war_win_rate", "recent_wars"]);
    expect(Object.keys((publicBody.recent_wars as Record<string, unknown>[])[0]!)).toEqual([
      "id", "event_id", "war_name", "enemy_name", "result", "own_stats", "enemy_stats",
      "duration_minutes", "created_at", "updated_at",
    ]);

    const internal = app();
    internal.route("/api/dashboard", createDashboardRoutes({ service }));
    const internalBody = await (await internal.request("/api/dashboard/wars")).json() as {
      recent_wars: Array<Record<string, unknown>>;
      recent_war_mvps: unknown[];
    };
    expect(internalBody.recent_wars[0]).toMatchObject({
      notes: "private note",
      created_by: "admin-1",
      updated_by: "admin-2",
    });
    expect(internalBody.recent_war_mvps).toHaveLength(1);

    const externalBody = await (await internal.request("/api/dashboard/wars?external_view=true")).json();
    expect(externalBody).toEqual(publicBody);
  });
});
