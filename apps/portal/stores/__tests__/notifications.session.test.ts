import { beforeEach, describe, expect, it, vi } from "vitest";
import { userScopedStorageKey } from "../../session-storage";
import {
  notificationStorageKeys,
  synchronizeNotificationStorage,
  useNotificationStore,
} from "../notifications";

const latestAnnouncement = "2099-08-01T00:00:00.000Z";

describe("notification session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.getState().setIdentity(null);
    useNotificationStore.getState().resetNotifications();
  });

  it("namespaces feature freshness by user id", () => {
    useNotificationStore.getState().setIdentity("user-a");
    useNotificationStore.getState().setFeatureLatest("announcements", latestAnnouncement);
    useNotificationStore.getState().markFeatureAsRead("announcements");
    const aKeys = notificationStorageKeys("user-a");

    useNotificationStore.getState().setIdentity("user-b");
    expect(useNotificationStore.getState().features.announcements.latestUpdatedAt).toBeNull();
    expect(localStorage.getItem(aKeys.features)).toContain("announcements");

    useNotificationStore.getState().setIdentity("user-a");
    expect(useNotificationStore.getState().features.announcements.lastSeenAt).toBe(latestAnnouncement);
  });

  it("removes the retired browser notification history for the active identity", () => {
    const legacyKey = userScopedStorageKey("portal:push-notification-center", "user-a");
    localStorage.setItem(legacyKey, "[]");

    useNotificationStore.getState().setIdentity("user-a");

    expect(localStorage.getItem(legacyKey)).toBeNull();
  });

  it("keeps in-memory defaults when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => useNotificationStore.getState().setIdentity("blocked-user")).not.toThrow();
    expect(useNotificationStore.getState().features.announcements.latestUpdatedAt).toBeNull();
  });

  it("reloads the active user's feature freshness from a storage event", () => {
    useNotificationStore.getState().setIdentity("user-a");
    const keys = notificationStorageKeys("user-a");
    localStorage.setItem(keys.features, JSON.stringify({
      announcements: { lastSeenAt: latestAnnouncement },
      members: { lastSeenAt: latestAnnouncement },
    }));

    synchronizeNotificationStorage(new StorageEvent("storage", { key: keys.features }));

    expect(useNotificationStore.getState().features.announcements.lastSeenAt).toBe(latestAnnouncement);
  });
});
