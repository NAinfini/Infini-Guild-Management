import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationSync } from "./useNotificationSync";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({ apiRequest }));

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

describe("useNotificationSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    apiRequest.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("invalidates on connect and ends the session without polling or reconnecting after 4401", async () => {
    const onConnected = vi.fn();
    const onUnauthorized = vi.fn();
    const { unmount } = renderHook(() => useNotificationSync({
      enabled: true,
      onConnected,
      onUnauthorized,
    }));
    await act(async () => Promise.resolve());

    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.onopen?.());
    expect(onConnected).toHaveBeenCalledOnce();

    act(() => socket.onclose?.({ code: 4401 } as CloseEvent));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    const callsAfterClose = apiRequest.mock.calls.length;

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(callsAfterClose);
    unmount();
  });
});
