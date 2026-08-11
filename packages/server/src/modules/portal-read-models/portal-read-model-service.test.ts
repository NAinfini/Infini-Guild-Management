import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import type { PortalReadModelStore, RuntimeHealthPort } from "./model.js";
import { AdminStatusService, PortalReadModelService } from "./portal-read-model-service.js";

const NOW = "2026-08-09T12:00:00.000Z";

function context(permissions: readonly string[] = [], authenticated = true) {
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
    dashboardMembers: vi.fn().mockResolvedValue({ activeMemberCount: 0, totalMemberCount: 0 }),
    dashboardEvents: vi.fn().mockResolvedValue({
      activeEventCount: 0,
      featuredEvents: [],
      upcomingEvents: [],
      mySignupEventIds: [],
    }),
    dashboardWars: vi.fn().mockResolvedValue({ allWarWinRate: 0, recentWars: [], recentWarMvps: [] }),
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("PortalReadModelService", () => {
  it("only exposes hidden dashboard events to an editor outside external view", async () => {
    const dashboardEvents = vi.fn().mockResolvedValue({
      activeEventCount: 0,
      featuredEvents: [],
      upcomingEvents: [],
      mySignupEventIds: [],
    });
    const service = new PortalReadModelService(store({ dashboardEvents }));
    const editor = context(["events.edit"]);

    await service.dashboardEvents(editor, false);
    await service.dashboardEvents(editor, true);

    expect(dashboardEvents.mock.calls[0]![0]).toMatchObject({
      viewerUserId: "user-1",
      canViewHidden: true,
    });
    expect(dashboardEvents.mock.calls[1]![0]).toMatchObject({
      viewerUserId: null,
      canViewHidden: false,
    });
  });

  it("enforces the global search bounds before touching persistence", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const service = new PortalReadModelService(store({ search }));

    await expect(service.search(context(), "x", 24)).resolves.toEqual([]);
    await expect(service.search(context(), "ok", 51)).rejects.toMatchObject({ status: 400 });
    expect(search).not.toHaveBeenCalled();

    await service.search(context(), "  Guild  ", 24);
    expect(search).toHaveBeenCalledWith({
      query: "Guild",
      limit: 24,
      perTypeLimit: 8,
      now: NOW,
    });
  });

  it("uses an explicit public war projection for guests and external view", async () => {
    const war = {
      id: "war-1",
      eventId: "event-1",
      status: "concluded" as const,
      warName: "Final",
      enemyName: "Rivals",
      result: "win" as const,
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
    };
    const dashboardWars = vi.fn().mockResolvedValue({
      allWarWinRate: 100,
      recentWars: [war],
      recentWarMvps: [[{
        category: "damage",
        label: "damage",
        name: "Secret Player",
        initials: "SP",
        value: 999,
      }]],
    });
    const service = new PortalReadModelService(store({ dashboardWars }));

    await expect(service.dashboardWars(context(), false)).resolves.toMatchObject({
      recentWars: [expect.objectContaining({ notes: "private note", createdBy: "admin-1" })],
      recentWarMvps: [[expect.objectContaining({ name: "Secret Player", value: 999 })]],
    });
    for (const projected of [
      await service.dashboardWars(context([], false), false),
      await service.dashboardWars(context(), true),
    ]) {
      expect(Object.keys(projected)).toEqual(["allWarWinRate", "recentWars"]);
      expect(Object.keys(projected.recentWars[0]!)).toEqual([
        "id", "eventId", "warName", "enemyName", "result", "ownStats", "enemyStats",
        "durationMinutes", "createdAt", "updatedAt",
      ]);
    }
  });
});

describe("AdminStatusService", () => {
  it("requires admin.status.view and returns platform-neutral health slots", async () => {
    const read = vi.fn().mockResolvedValue({
      database: "ok",
      blob: "configured",
      realtime: "ok",
      scheduler: "ok",
    });
    const service = new AdminStatusService({ read } satisfies RuntimeHealthPort);

    await expect(service.status(context())).rejects.toMatchObject({ status: 403 });
    await expect(service.status(context(["admin.status.view"]))).resolves.toMatchObject({ database: "ok" });
    expect(read).toHaveBeenCalledOnce();
  });
});
