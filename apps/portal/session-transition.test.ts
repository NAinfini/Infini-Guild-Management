import type { MemberProfile, User } from "@guild/shared";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import {
  AUTH_SESSION_STORAGE_KEY,
  authenticateSession,
  getSessionSnapshot,
  installSessionSynchronization,
  logoutSession,
  resolveSessionSnapshot,
  revalidateSessionSnapshot,
  transitionSession,
  type PortalSession,
} from "./session-transition";
import { useAuthStore } from "./stores/auth";
import { useGuildWarStore } from "./stores/guildWar";
import { usePreferencesStore } from "./stores/preferences";
import { deferred } from "./testing/deferred";

function session(id: string) {
  return {
    user: { id, display_name: id, permissions: {} } as User,
    profile: { user_id: id } as MemberProfile,
    session_scope: "normal" as const,
  };
}

function dispatchSignal(id: string, action: "login" | "logout") {
  window.dispatchEvent(new StorageEvent("storage", {
    key: AUTH_SESSION_STORAGE_KEY,
    newValue: JSON.stringify({ id, action }),
  }));
}

describe("session transitions", () => {
  beforeEach(() => {
    let previous: Promise<unknown> = Promise.resolve();
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn((_name: string, callback: () => Promise<unknown>) => {
          const request = previous.then(callback);
          previous = request.catch(() => undefined);
          return request;
        }),
      },
    });
    localStorage.clear();
    useAuthStore.getState().clearSession();
    useGuildWarStore.getState().resetSessionState();
    usePreferencesStore.getState().setThemeMode("dark");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it.each(["logout", "login"] as const)("ignores a cross-tab lookup after a newer %s", async (action) => {
    const queryClient = new QueryClient();
    const oldRequest = deferred<PortalSession>();
    const onSessionChange = vi.fn();
    const stop = installSessionSynchronization({ queryClient, requestSession: () => oldRequest.promise, onSessionChange });
    dispatchSignal("old-login", "login");
    if (action === "logout") dispatchSignal("new-logout", "logout");
    else transitionSession(queryClient, session("user-b"), { broadcast: false });
    onSessionChange.mockClear();
    queryClient.setQueryData(["private"], { owner: action === "login" ? "user-b" : null });
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    oldRequest.resolve(session("user-a"));
    await oldRequest.promise;
    await Promise.resolve();
    expect(useAuthStore.getState().user?.id ?? null).toBe(action === "login" ? "user-b" : null);
    expect(queryClient.getQueryData(["private"])).toEqual({ owner: action === "login" ? "user-b" : null });
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    stop();
  });

  it("ignores stale cross-tab errors and responses after the listener is uninstalled", async () => {
    const queryClient = new QueryClient();
    const first = deferred<PortalSession>();
    const second = deferred<PortalSession>();
    const onSessionChange = vi.fn();
    const requestSession = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const stop = installSessionSynchronization({ queryClient, requestSession, onSessionChange });
    dispatchSignal("first", "login");
    dispatchSignal("second", "login");
    first.reject(new ApiRequestError("old session", { status: 401 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onSessionChange).not.toHaveBeenCalled();
    stop();
    second.resolve(session("user-a"));
    await second.promise;
    expect(getSessionSnapshot()).toBeNull();
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("does not restore a session when a pending revalidation completes after logout", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    const oldRequest = deferred<PortalSession>();
    const result = revalidateSessionSnapshot(queryClient, () => oldRequest.promise);
    transitionSession(queryClient, null, { broadcast: false });
    oldRequest.resolve(session("user-a"));
    await expect(result).resolves.toBeNull();
    expect(getSessionSnapshot()).toBeNull();
  });

  it.each([401, 503])("ignores an old status %s after a newer session, including the same user", async (status) => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    const oldRequest = deferred<PortalSession>();
    const result = revalidateSessionSnapshot(queryClient, () => oldRequest.promise);
    const updated = session("user-a");
    updated.user.display_name = "new session";
    transitionSession(queryClient, updated, { broadcast: false });
    queryClient.setQueryData(["private"], "new-cache");
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    oldRequest.reject(new ApiRequestError("stale failure", { status }));
    await expect(result).resolves.toEqual(updated);
    expect(queryClient.getQueryData(["private"])).toBe("new-cache");
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("keeps the newest revalidation when responses finish out of order", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    const oldRequest = deferred<PortalSession>();
    const oldResult = revalidateSessionSnapshot(queryClient, () => oldRequest.promise);
    const updated = session("user-a");
    updated.user.display_name = "updated permissions";
    await revalidateSessionSnapshot(queryClient, async () => updated);
    oldRequest.resolve(session("user-a"));
    await expect(oldResult).resolves.toEqual(updated);
    expect(getSessionSnapshot()).toEqual(updated);
  });

  it("clears state only for a current authoritative 401", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    const error = new ApiRequestError("expired", { status: 401 });
    await expect(resolveSessionSnapshot(queryClient, async () => { throw error; })).resolves.toBeNull();
    expect(getSessionSnapshot()).toBeNull();
  });

  it.each([0, 500, 503])("preserves the session and reports a current status %s failure", async (status) => {
    const queryClient = new QueryClient();
    const current = session("user-a");
    transitionSession(queryClient, current, { broadcast: false });
    const error = new ApiRequestError("temporary failure", { status });
    await expect(resolveSessionSnapshot(queryClient, async () => { throw error; })).rejects.toBe(error);
    expect(getSessionSnapshot()).toEqual(current);
  });

  it("serializes a pending login before logout so its cookie cannot arrive last", async () => {
    const queryClient = new QueryClient();
    const oldRequest = deferred<PortalSession>();
    let cookie: string | null = null;
    const requestLogin = vi.fn(async () => {
      const response = await oldRequest.promise;
      cookie = response.user.id;
      return response;
    });
    const loginResult = authenticateSession(queryClient, requestLogin);
    await vi.waitFor(() => expect(requestLogin).toHaveBeenCalledOnce());
    const requestLogout = vi.fn(async () => { cookie = null; });
    const logoutResult = logoutSession(queryClient, requestLogout);
    expect(getSessionSnapshot()).toBeNull();
    expect(requestLogout).not.toHaveBeenCalled();
    oldRequest.resolve(session("user-a"));
    await expect(loginResult).resolves.toBeNull();
    await logoutResult;
    expect(requestLogout).toHaveBeenCalledOnce();
    expect(cookie).toBeNull();
    expect(getSessionSnapshot()).toBeNull();
    expect(JSON.parse(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)!)).toMatchObject({ action: "logout" });
  });

  it.each(["success", "error"])("ignores an old login %s while a newer login owns the session", async (completion) => {
    const queryClient = new QueryClient();
    const oldRequest = deferred<PortalSession>();
    const requestLogin = vi.fn(() => oldRequest.promise);
    const oldResult = authenticateSession(queryClient, requestLogin);
    await vi.waitFor(() => expect(requestLogin).toHaveBeenCalledOnce());
    const clearSpy = vi.spyOn(queryClient, "clear");
    const newResult = authenticateSession(queryClient, async () => session("user-b"));
    if (completion === "success") oldRequest.resolve(session("user-a"));
    else oldRequest.reject(new ApiRequestError("old credentials", { status: 401 }));
    await expect(oldResult).resolves.toBeNull();
    const accepted = await newResult;
    expect(accepted?.session.user.id).toBe("user-b");
    expect(accepted?.isCurrent()).toBe(true);
    expect(clearSpy).toHaveBeenCalledOnce();
    transitionSession(queryClient, null, { broadcast: false });
    expect(accepted?.isCurrent()).toBe(false);
  });

  it("does not let a background lookup supersede password reset while its cookie is being replaced", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, { ...session("user-a"), session_scope: "password_change" }, { broadcast: false });
    const reset = deferred<PortalSession>();
    const result = authenticateSession(queryClient, () => reset.promise);
    const requestSession = vi.fn();
    await revalidateSessionSnapshot(queryClient, requestSession);
    expect(requestSession).not.toHaveBeenCalled();
    reset.resolve(session("user-a"));
    await result;
    expect(useAuthStore.getState().sessionScope).toBe("normal");
  });

  it("ignores a pending logout failure after a newer login begins", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    const pending = deferred<unknown>();
    const requestLogout = vi.fn(() => pending.promise);
    const oldLogout = logoutSession(queryClient, requestLogout);
    await vi.waitFor(() => expect(requestLogout).toHaveBeenCalledOnce());
    const newLogin = authenticateSession(queryClient, async () => session("user-b"));
    pending.reject(new ApiRequestError("old logout", { status: 401 }));
    await expect(oldLogout).resolves.toBeUndefined();
    await newLogin;
    expect(getSessionSnapshot()?.user.id).toBe("user-b");
    expect(JSON.parse(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)!)).toMatchObject({ action: "login" });
  });

  it("does not let an earlier cross-tab logout cancel the login that follows it in the cookie lock", async () => {
    const queryClient = new QueryClient();
    const pending = deferred<PortalSession>();
    const requestLogin = vi.fn(() => pending.promise);
    const onSessionChange = vi.fn();
    const stop = installSessionSynchronization({ queryClient, onSessionChange });
    const result = authenticateSession(queryClient, requestLogin);
    await vi.waitFor(() => expect(requestLogin).toHaveBeenCalledOnce());
    dispatchSignal("previous-cookie-write", "logout");
    pending.resolve(session("user-b"));
    const accepted = await result;
    expect(accepted?.isCurrent()).toBe(true);
    expect(getSessionSnapshot()?.user.id).toBe("user-b");
    expect(onSessionChange).not.toHaveBeenCalled();
    stop();
  });

  it("does not silently issue cookie writes without cross-tab locking", async () => {
    vi.stubGlobal("navigator", {});
    const requestSession = vi.fn();
    await expect(authenticateSession(new QueryClient(), requestSession)).rejects.toBeInstanceOf(Error);
    expect(requestSession).not.toHaveBeenCalled();
  });
});
