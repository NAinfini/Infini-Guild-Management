import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePushSync } from "./usePushSync";

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

  send() {}
  close() {}
}

describe("usePushSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
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
});
