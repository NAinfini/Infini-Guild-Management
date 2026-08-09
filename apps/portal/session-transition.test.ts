// @vitest-environment jsdom
import type { MemberProfile, PushMessage, User } from "@guild/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_STORAGE_KEY,
  installSessionSynchronization,
  transitionSession,
} from "./session-transition";
import { useAuthStore } from "./stores/auth";
import { useGuildWarStore } from "./stores/guildWar";
import { useNotificationStore } from "./stores/notifications";
import { usePreferencesStore } from "./stores/preferences";

function session(id: string) {
  return {
    user: { id, username: id, permissions: {} } as User,
    profile: { user_id: id } as MemberProfile,
  };
}

const push = {
  type: "announcement_published",
  announcement_id: "announcement-a",
  title: "Only A should see this",
  published_at: "2026-08-01T00:00:00.000Z",
} as PushMessage;

describe("session transitions", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearSession();
    useNotificationStore.getState().setIdentity(null);
    useNotificationStore.getState().resetNotifications();
    useGuildWarStore.getState().resetSessionState();
    usePreferencesStore.getState().setThemeMode("dark");
  });

  it("does not carry A's query, notification, or guild-war state into B", () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    queryClient.setQueryData(["private"], { owner: "user-a" });
    useNotificationStore.getState().appendPushMessage(push);
    useGuildWarStore.getState().setSelectedEventId("event-a");

    transitionSession(queryClient, null, { broadcast: false });
    transitionSession(queryClient, session("user-b"), { broadcast: false });

    expect(queryClient.getQueryData(["private"])).toBeUndefined();
    expect(useNotificationStore.getState().pushHistory).toEqual([]);
    expect(useGuildWarStore.getState().selectedEventId).toBeUndefined();
    expect(usePreferencesStore.getState().themeMode).toBe("dark");
  });

  it("applies a cross-tab login without writing an echo event", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    queryClient.setQueryData(["private"], { owner: "user-a" });
    const requestSession = vi.fn().mockResolvedValue(session("user-b"));
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const stop = installSessionSynchronization({ queryClient, requestSession });

    window.dispatchEvent(new StorageEvent("storage", {
      key: AUTH_SESSION_STORAGE_KEY,
      newValue: JSON.stringify({ id: "external-event", action: "login" }),
    }));

    await vi.waitFor(() => expect(useAuthStore.getState().user?.id).toBe("user-b"));
    expect(queryClient.getQueryData(["private"])).toBeUndefined();
    expect(storageSpy.mock.calls.some(([key]) => key === AUTH_SESSION_STORAGE_KEY)).toBe(false);
    stop();
  });
});
