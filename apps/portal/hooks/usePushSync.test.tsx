import { act, renderHook } from "@testing-library/react";
import type { MemberProfile, User } from "@guild/shared";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePushSync } from "./usePushSync";
import { useAuthStore } from "../stores/auth";
import { transitionSession } from "../session-transition";

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn();
}

function session(id: string) {
  return {
    user: { id } as User,
    profile: { user_id: id } as MemberProfile,
    session_scope: "normal" as const,
  };
}

describe("usePushSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    useAuthStore.getState().clearSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not refresh the initial connection and ends the session without reconnecting after 4401", async () => {
    const onRefresh = vi.fn();
    const onUnauthorized = vi.fn();
    const { unmount } = renderHook(() => usePushSync({
      enabled: true,
      onRefresh,
      onUnauthorized,
    }));
    await act(async () => Promise.resolve());

    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.onopen?.());
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => socket.onclose?.({ code: 4401 } as CloseEvent));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("refreshes after reconnecting", async () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => usePushSync({ onRefresh }));
    await act(async () => Promise.resolve());

    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.onopen?.());
    act(() => socket.onclose?.({ code: 1006 } as CloseEvent));
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    act(() => FakeWebSocket.instances[1]?.onopen?.());
    expect(onRefresh).toHaveBeenCalledOnce();
    unmount();
  });

  it("refreshes while server policy prevents a realtime connection", async () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => usePushSync({ onRefresh }));
    await act(async () => Promise.resolve());

    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.onclose?.({ code: 1008 } as CloseEvent));
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("creates no realtime or refresh side effects when disabled", async () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => usePushSync({ enabled: false, onRefresh }));

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
    unmount();
  });

  it("replaces A's connection with B's and rejects A's late callbacks before and after cleanup", async () => {
    const queryClient = new QueryClient();
    transitionSession(queryClient, session("user-a"), { broadcast: false });
    const onMessage = vi.fn();
    const onRefresh = vi.fn();
    const onUnauthorized = vi.fn();
    const { unmount } = renderHook(() => usePushSync({ enabled: true, onMessage, onRefresh, onUnauthorized }));
    const oldSocket = FakeWebSocket.instances[0]!;
    act(() => oldSocket.onopen?.());
    const lateOpen = oldSocket.onopen;
    const lateMessage = oldSocket.onmessage;
    const lateClose = oldSocket.onclose;
    const message = { data: JSON.stringify({ type: "inbox_changed", user_id: "user-a" }) } as MessageEvent;
    act(() => {
      transitionSession(queryClient, session("user-b"), { broadcast: false });
      lateClose?.({ code: 4401 } as CloseEvent);
      lateMessage?.(message);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(oldSocket.close).toHaveBeenCalledOnce();
    expect(oldSocket.onopen).toBeNull();
    expect(oldSocket.onmessage).toBeNull();
    expect(oldSocket.onclose).toBeNull();
    const newSocket = FakeWebSocket.instances[1]!;
    act(() => {
      newSocket.onopen?.();
      lateOpen?.();
      lateMessage?.(message);
      lateClose?.({ code: 4401 } as CloseEvent);
    });
    await act(async () => vi.advanceTimersByTimeAsync(25_000));
    expect(oldSocket.send).not.toHaveBeenCalled();
    expect(newSocket.send).toHaveBeenCalledOnce();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps a connection for ordinary /me refreshes and replaces it for a new session of the same user", () => {
    const queryClient = new QueryClient();
    const current = session("user-a");
    transitionSession(queryClient, current, { broadcast: false });
    const { unmount } = renderHook(() => usePushSync({ enabled: true }));
    const oldSocket = FakeWebSocket.instances[0]!;
    act(() => useAuthStore.getState().setSession({ ...current.user, display_name: "Updated" }, current.profile, "normal"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(oldSocket.close).not.toHaveBeenCalled();
    act(() => transitionSession(queryClient, current, { broadcast: false }));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(oldSocket.close).toHaveBeenCalledOnce();
    unmount();
  });

  it("clears reconnect and polling timers when the session scope changes", async () => {
    const queryClient = new QueryClient();
    const current = session("user-a");
    transitionSession(queryClient, current, { broadcast: false });
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => {
      const enabled = useAuthStore((state) => state.sessionScope === "normal");
      usePushSync({ enabled, onRefresh });
    });
    const oldSocket = FakeWebSocket.instances[0]!;
    act(() => oldSocket.onclose?.({ code: 1006 } as CloseEvent));
    act(() => useAuthStore.getState().setSession(current.user, current.profile, "password_change"));
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => useAuthStore.getState().setSession(current.user, current.profile, "normal"));
    expect(FakeWebSocket.instances).toHaveLength(2);
    unmount();
  });
});
