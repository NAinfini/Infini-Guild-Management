import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext } from "@guild/kernel";
import { NotificationService, canReceiveNotification } from "./notification-service";

function authorization(permissions: readonly string[], userId = "user-1") {
  return createAuthorizationContext({
    userId,
    sessionId: "session-1",
    roleId: "member",
    roleLevel: 100,
    permissions,
  });
}

describe("NotificationService", () => {
  it("rejects invalid outbound messages before broadcasting", async () => {
    const publish = vi.fn();
    const service = new NotificationService({ publish });
    await expect(service.publish({ type: "entity_changed", entity_type: "secret" }))
      .rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });

  it("builds bounded heartbeat acknowledgements", () => {
    const service = new NotificationService({ publish: vi.fn() });
    expect(service.heartbeat({
      type: "heartbeat",
      tab_id: "tab-1",
      seq: 3,
      sent_at: "2026-08-09T00:00:00.000Z",
    }, "2026-08-09T00:00:01.000Z", 2)).toEqual({
      type: "heartbeat_ack",
      tab_id: "tab-1",
      seq: 3,
      server_at: "2026-08-09T00:00:01.000Z",
      connections: 2,
    });
  });

  it("filters moderation-only hints by the exact server permission", () => {
    const message = {
      type: "entity_changed",
      entity_type: "member_badge",
      entity_id: "badge-1",
      updated_at: "2026-08-09T00:00:00.000Z",
      hint: "badge_assigned",
    } as const;
    expect(canReceiveNotification(authorization([]), message)).toBe(false);
    expect(canReceiveNotification(authorization(["admin.badges.manage"]), message)).toBe(true);
  });

  it("accepts category catalog updates and broadcasts them to members", async () => {
    const publish = vi.fn();
    const service = new NotificationService({ publish });
    const message = {
      type: "entity_changed",
      entity_type: "wiki",
      entity_id: "categories",
      updated_at: "2026-08-09T00:00:00.000Z",
      hint: "categories_updated",
    } as const;

    await service.publish(message);
    expect(publish).toHaveBeenCalledWith(message);
    expect(canReceiveNotification(authorization([]), message)).toBe(true);
  });

  it.each(["item_liked", "item_unliked"] as const)(
    "accepts gallery %s updates and broadcasts them to members",
    async (hint) => {
      const publish = vi.fn();
      const service = new NotificationService({ publish });
      const message = {
        type: "entity_changed",
        entity_type: "gallery",
        entity_id: "gallery-1",
        updated_at: "2026-08-09T00:00:00.000Z",
        hint,
      } as const;

      await service.publish(message);
      expect(publish).toHaveBeenCalledWith(message);
      expect(canReceiveNotification(authorization([]), message)).toBe(true);
    },
  );

  it("delivers personal inbox changes only to the targeted user", () => {
    const message = { type: "inbox_changed", user_id: "user-1" } as const;

    expect(canReceiveNotification(authorization([], "user-1"), message)).toBe(true);
    expect(canReceiveNotification(authorization([], "user-2"), message)).toBe(false);
  });

  it.each(["event_created", "event_archived", "raffle_drawn", "announcement_published"] as const)(
    "allows a coalesced %s hint for every member without per-entity filtering",
    (hint) => {
      const message = {
        type: "entity_changed",
        entity_type: hint === "announcement_published" ? "announcement" : "event",
        entity_id: "first-committed-entity",
        updated_at: "2026-08-09T00:00:00.000Z",
        hint,
      };
      expect(canReceiveNotification(authorization([]), message)).toBe(true);
      expect(canReceiveNotification(authorization([], "another-user"), message)).toBe(true);
      expect(canReceiveNotification(createAuthorizationContext(null), message)).toBe(false);
    },
  );
});
