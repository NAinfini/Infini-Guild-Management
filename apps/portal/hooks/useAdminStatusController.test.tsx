// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminStatusController } from "./useAdminStatusController";

type StatusResponse = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

const STORAGE_KEY = "admin.status.health.logs";

function createStatusQuery(data: StatusResponse) {
  return {
    refetch: vi.fn().mockResolvedValue({ data }),
  };
}

describe("useAdminStatusController", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.setSystemTime(new Date("2026-06-11T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("records status latency and persists successful health checks", async () => {
    const statusQuery = createStatusQuery({ db: "ok", r2: "ok", ws: "ok", crons: "ok" });
    const { result } = renderHook(() =>
      useAdminStatusController({
        statusQuery,
        activeTab: "users",
        isAdmin: true,
      }),
    );

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(statusQuery.refetch).toHaveBeenCalledTimes(1);
    expect(result.current.statusLatencyMs).toBeGreaterThanOrEqual(1);
    expect(result.current.statusHealthLogs).toEqual([
      {
        at: "2026-06-11T18:00:00.000Z",
        db: "ok",
        r2: "ok",
        ws: "ok",
        crons: "ok",
        latencyMs: result.current.statusLatencyMs,
      },
    ]);
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1);
    });
  });

  it("loads only valid persisted health logs and keeps the newest 10 entries", async () => {
    const persisted = Array.from({ length: 12 }, (_, index) => ({
      at: `2026-06-11T18:${String(index).padStart(2, "0")}:00.000Z`,
      db: "ok",
      r2: "ok",
      ws: "ok",
      crons: "ok",
      latencyMs: index + 1,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      ...persisted,
      { at: "invalid", db: "ok" },
    ]));

    const statusQuery = createStatusQuery({ db: "error", r2: "ok", ws: "degraded", crons: "ok" });
    const { result } = renderHook(() =>
      useAdminStatusController({
        statusQuery,
        activeTab: "users",
        isAdmin: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.statusHealthLogs).toHaveLength(10);
    });

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.statusHealthLogs).toHaveLength(10);
    expect(result.current.statusHealthLogs[0]).toMatchObject({
      at: "2026-06-11T18:00:00.000Z",
      db: "error",
      ws: "degraded",
      latencyMs: result.current.statusLatencyMs,
    });
  });

  it("polls status only while the status tab is active for admins", async () => {
    vi.useFakeTimers();
    const statusQuery = createStatusQuery({ db: "ok", r2: "ok", ws: "ok", crons: "ok" });

    renderHook(() =>
      useAdminStatusController({
        statusQuery,
        activeTab: "users",
        isAdmin: true,
      }),
    );

    expect(statusQuery.refetch).not.toHaveBeenCalled();

    const { unmount } = renderHook(() =>
      useAdminStatusController({
        statusQuery,
        activeTab: "status",
        isAdmin: true,
      }),
    );

    await act(async () => {});
    expect(statusQuery.refetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(statusQuery.refetch).toHaveBeenCalledTimes(2);
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(statusQuery.refetch).toHaveBeenCalledTimes(2);
  });
});
