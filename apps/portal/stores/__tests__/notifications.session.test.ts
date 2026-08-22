import type { PushMessage } from "@guild/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationStorageKeys,
  synchronizeNotificationStorage,
  useNotificationStore,
} from "../notifications";

const push = {
  type: "announcement_published",
  announcement_id: "announcement-a",
  title: "A-only title",
  published_at: "2026-08-01T00:00:00.000Z",
} as PushMessage;

describe("notification session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.getState().setIdentity(null);
    useNotificationStore.getState().resetNotifications();
  });

  it("namespaces push content and read state by user id", () => {
    useNotificationStore.getState().setIdentity("user-a");
    useNotificationStore.getState().appendPushMessage(push);
    useNotificationStore.getState().markPushAsRead("announcement:announcement-a");
    const aKeys = notificationStorageKeys("user-a");

    useNotificationStore.getState().setIdentity("user-b");
    expect(useNotificationStore.getState().pushHistory).toEqual([]);
    expect(localStorage.getItem(aKeys.push)).toContain("A-only title");

    useNotificationStore.getState().setIdentity("user-a");
    expect(localStorage.getItem(aKeys.push)).not.toBeNull();
    expect(useNotificationStore.getState().pushHistory[0]).toMatchObject({
      title: "Announcement Published",
      message: "A-only title",
    });
    expect(useNotificationStore.getState().pushHistory[0]?.readAt).not.toBeNull();
  });

  it("keeps in-memory defaults when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => useNotificationStore.getState().setIdentity("blocked-user")).not.toThrow();
    expect(useNotificationStore.getState().pushHistory).toEqual([]);
  });

  it("reloads the active user's read history from a storage event", () => {
    useNotificationStore.getState().setIdentity("user-a");
    useNotificationStore.getState().appendPushMessage(push);
    const keys = notificationStorageKeys("user-a");
    const stored = JSON.parse(localStorage.getItem(keys.push) ?? "[]") as Array<Record<string, unknown>>;
    stored[0] = { ...stored[0], readAt: "2026-08-02T00:00:00.000Z" };
    localStorage.setItem(keys.push, JSON.stringify(stored));

    synchronizeNotificationStorage(new StorageEvent("storage", { key: keys.push }));

    expect(useNotificationStore.getState().pushHistory[0]?.readAt).toBe("2026-08-02T00:00:00.000Z");
  });
});
