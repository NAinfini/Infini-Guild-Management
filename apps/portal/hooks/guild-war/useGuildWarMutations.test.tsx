import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuildWarMutations } from "./useGuildWarMutations";

const serviceMocks = vi.hoisted(() => ({
  batchUpdateGuildWarMemberStats: vi.fn(),
  deleteGuildWarHistory: vi.fn(),
  downloadGuildWarExport: vi.fn(),
  updateGuildWarRoleTags: vi.fn(),
}));
const showErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/GuildWarService", () => serviceMocks);
vi.mock("../useAppError", () => ({
  useAppError: () => ({ showError: showErrorMock }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../utils/notifications", () => ({ notifySuccess: vi.fn() }));

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useGuildWarMutations", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }
    showErrorMock.mockReset();
  });

  it("exports the history record selected in the detail pane", async () => {
    serviceMocks.downloadGuildWarExport.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(
      () => useGuildWarMutations({
        selectedEventId: "event-1",
        selectedHistoryId: "history-1",
        setSelectedHistoryId: vi.fn(),
      }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await expect(result.current.exportHistoryMutation.mutateAsync("csv")).rejects.toThrow("network");
    });

    expect(serviceMocks.downloadGuildWarExport).toHaveBeenCalledWith({
      format: "csv",
      history_id: "history-1",
    });
  });

  it("forwards the history revision captured by the editor", async () => {
    serviceMocks.batchUpdateGuildWarMemberStats.mockResolvedValueOnce({ data: [] });
    const { result } = renderHook(
      () => useGuildWarMutations({
        selectedEventId: "event-1",
        selectedHistoryId: "history-1",
        setSelectedHistoryId: vi.fn(),
      }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.saveHistoryMemberStats(
        [{ userId: "user-1", payload: { kills: 9, deaths: 2 } }],
        '"history-history-1-4"',
      );
    });

    expect(serviceMocks.batchUpdateGuildWarMemberStats).toHaveBeenCalledWith(
      "history-1",
      [{ user_id: "user-1", stats: { stats: { kills: 9, deaths: 2 } } }],
      '"history-history-1-4"',
    );
  });
});
