import { describe, expect, it, vi } from "vitest";
import {
  createAuthorizationContext,
  createRequestContext,
  type DeferredTask,
  type DeferredTasks,
  type NotificationPublisher,
} from "@guild/kernel";
import { NotificationInboxService, type NotificationInboxStore } from "./inbox-service";

const NOW = "2026-08-09T00:00:00.000Z";

function context() {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
    now: NOW,
  });
}

function store(overrides: Partial<NotificationInboxStore> = {}): NotificationInboxStore {
  return {
    list: vi.fn(),
    markRead: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    ...overrides,
  };
}

describe("NotificationInboxService", () => {
  it("lists the authenticated member's recent inbox without an unread-status branch", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], nextCursor: null, unreadCount: 0 });
    const service = new NotificationInboxService(store({ list }), { publish: vi.fn() }, { defer: vi.fn() });

    await expect(service.list(context(), { limit: 50, cursor: null })).resolves.toEqual({
      data: [],
      next_cursor: null,
      unread_count: 0,
    });
    expect(list).toHaveBeenCalledWith({ userId: "user-1", limit: 50, cursor: null, now: NOW });
  });

  it("marks requested notifications read and publishes one targeted inbox refresh", async () => {
    const tasks: DeferredTask[] = [];
    const markRead = vi.fn().mockResolvedValue(2);
    const publish = vi.fn().mockResolvedValue(undefined);
    const deferred: DeferredTasks = { defer: (task) => { tasks.push(task); } };
    const notifications: NotificationPublisher = { publish };
    const service = new NotificationInboxService(store({ markRead }), notifications, deferred);

    await expect(service.markRead(context(), { ids: ["notification-1"] })).resolves.toEqual({
      ok: true,
      unread_count: 2,
    });
    expect(markRead).toHaveBeenCalledWith({ userId: "user-1", ids: ["notification-1"], now: NOW });
    expect(tasks).toHaveLength(1);

    await tasks[0]!();
    expect(publish).toHaveBeenCalledWith({ type: "inbox_changed", user_id: "user-1" });
  });

  it("reads and updates the authenticated member's notification preferences", async () => {
    const preferences = {
      member_joined: true,
      announcement_published: true,
      event_created: false,
      wiki_article_created: true,
      updated_at: NOW,
    };
    const updatedPreferences = { ...preferences, announcement_published: false };
    const getPreferences = vi.fn()
      .mockResolvedValueOnce(preferences)
      .mockResolvedValueOnce(preferences);
    const updatePreferences = vi.fn().mockResolvedValue(updatedPreferences);
    const service = new NotificationInboxService(
      store({ getPreferences, updatePreferences }),
      { publish: vi.fn() },
      { defer: vi.fn() },
    );

    await expect(service.getPreferences(context())).resolves.toEqual(preferences);
    await expect(service.updatePreferences(context(), { announcement_published: false }))
      .resolves.toEqual(updatedPreferences);
    expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      patch: { announcement_published: false },
      now: NOW,
      audit: expect.any(Object),
    }));
  });
});
