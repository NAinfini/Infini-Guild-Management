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
    countUnread: vi.fn(),
    list: vi.fn(),
    markRead: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    ...overrides,
  };
}

describe("NotificationInboxService", () => {
  it("counts only the authenticated member's current inbox without loading notification rows", async () => {
    const inboxStore = store({ countUnread: vi.fn().mockResolvedValue(7) });
    const service = new NotificationInboxService(inboxStore, { publish: vi.fn() }, { defer: vi.fn() });

    await expect(service.getUnreadCount(context())).resolves.toEqual({ unread_count: 7 });

    expect(inboxStore.countUnread).toHaveBeenCalledWith({ userId: "user-1", now: NOW });
    expect(inboxStore.list).not.toHaveBeenCalled();
  });

  it("rejects anonymous unread-count requests before reading storage", async () => {
    const inboxStore = store();
    const service = new NotificationInboxService(inboxStore, { publish: vi.fn() }, { defer: vi.fn() });
    const anonymous = createRequestContext({
      requestId: "anonymous-request",
      authorization: createAuthorizationContext(null),
      now: NOW,
    });

    await expect(service.getUnreadCount(anonymous)).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(inboxStore.countUnread).not.toHaveBeenCalled();
  });

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
