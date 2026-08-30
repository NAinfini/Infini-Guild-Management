import type { MemberProfile, User } from "@guild/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_STORAGE_KEY,
  installSessionSynchronization,
  transitionSession,
} from "./session-transition";
import { useAuthStore } from "./stores/auth";
import { useGuildWarStore } from "./stores/guildWar";
import { usePreferencesStore } from "./stores/preferences";

function session(id: string) {
  return {
    user: { id, display_name: id, permissions: {} } as User,
    profile: { user_id: id } as MemberProfile,
    session_scope: "normal" as const,
  };
}

describe("session transitions", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearSession();
    useGuildWarStore.getState().resetSessionState();
    usePreferencesStore.getState().setThemeMode("dark");
  });

  it("does not carry A's query or guild-war state into B", () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    queryClient.setQueryData(["private"], { owner: "user-a" });
    useGuildWarStore.getState().setSelectedEventId("event-a");

    transitionSession(queryClient, null, { broadcast: false });
    transitionSession(queryClient, session("user-b"), { broadcast: false });

    expect(queryClient.getQueryData(["private"])).toBeUndefined();
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
