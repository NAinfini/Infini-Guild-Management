import type { MemberProfile, MemberSummary } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterEntry } from "./useRosterPageController";
import { useRosterPageController } from "./useRosterPageController";

const stopAudioMock = vi.hoisted(() => vi.fn());
const fetchUsersListMock = vi.hoisted(() => vi.fn());
const fetchUserDetailMock = vi.hoisted(() => vi.fn());
vi.mock("./useDebouncedSearch", () => ({
  useDebouncedSearch: () => ({ search: "", setSearch: vi.fn(), debouncedSearch: "" }),
}));

vi.mock("./useExternalView", () => ({ useExternalView: () => false }));
vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({ canManage: () => false }),
}));
vi.mock("../stores/auth", () => ({ useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
vi.mock("../services/UserService", () => ({
  fetchUsersListWithOptions: fetchUsersListMock,
  fetchUserDetail: fetchUserDetailMock,
}));
/* 只截数据钩子；resolveClassCatalogItem 是纯函数，空目录下的真实现就是这里
   想要的降级行为。 */
vi.mock("./data/useClassData", () => ({
  useClassCatalog: () => [],
}));
vi.mock("../utils/audio-player", () => ({
  playAudio: vi.fn(),
  stopAudio: stopAudioMock,
  setAudioVolume: vi.fn(),
  setAudioMuted: vi.fn(),
  isAudioPlaying: () => false,
  getAudioSrc: () => null,
}));
vi.mock("../utils/media", () => ({ resolveMediaUrl: (key: string) => key }));

function row(bio: string, power: number): RosterEntry {
  return {
    user: { id: "user-1", display_name: "Alice", role: "member", is_active: true } as MemberSummary,
    profile: {
      user_id: "user-1",
      bio,
      power,
      classes: ["warrior"],
      notes: null,
    } as MemberProfile,
    badges: [],
  };
}

function renderController() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(() => useRosterPageController(), { wrapper });
}

describe("useRosterPageController", () => {
  beforeEach(() => {
    localStorage.clear();
    stopAudioMock.mockReset();
    fetchUsersListMock.mockReset();
    fetchUserDetailMock.mockReset();
    fetchUsersListMock.mockResolvedValue({ data: [row("list bio", 10)], total: 1000, total_pages: 42, page: 1, limit: 24 });
    fetchUserDetailMock.mockResolvedValue(row("detail bio", 99));
  });

  it("fetches only the requested 24-member page with the public projection and global total", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.usersQuery.isSuccess).toBe(true));
    expect(fetchUsersListMock).toHaveBeenCalledTimes(1);
    expect(fetchUsersListMock).toHaveBeenCalledWith(expect.objectContaining({ externalView: true, page: 1, limit: 24, includeTotal: true, sort: "power", direction: "desc", searchScope: "name", signal: expect.any(AbortSignal) }));
    expect(result.current.totalCount).toBe(1000);
    expect(result.current.pageCount).toBe(42);
    expect(result.current.isExternalView).toBe(false);
    act(() => result.current.setPage(2));
    await waitFor(() => expect(fetchUsersListMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 24 })));
    expect(fetchUsersListMock).toHaveBeenCalledTimes(2);
  });

  it("loads the selected profile independently and keeps it open across page changes", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.pageRows).toHaveLength(1));
    act(() => result.current.openMemberProfile(result.current.pageRows[0]!));
    await waitFor(() => expect(result.current.selected?.profile.bio).toBe("detail bio"));
    expect(fetchUserDetailMock).toHaveBeenCalledWith("user-1", { externalView: true, signal: expect.any(AbortSignal) });
    fetchUsersListMock.mockResolvedValueOnce({ data: [], total: 1000, total_pages: 42, page: 2, limit: 24 });
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.usersQuery.isSuccess).toBe(true));
    expect(result.current.selected?.profile.power).toBe(99);
    fetchUserDetailMock.mockResolvedValueOnce(row("refetched detail", 100));
    await act(async () => { await result.current.selectedQuery.refetch(); });
    await waitFor(() => expect(result.current.selected?.profile.bio).toBe("refetched detail"));
  });

  it("sends class OR filters and global sorting to the server and resets the page", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.usersQuery.isSuccess).toBe(true));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(fetchUsersListMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 })));
    act(() => { result.current.setClassFilter(["warrior", "mage"]); result.current.setSortMode("class"); });
    await waitFor(() => expect(fetchUsersListMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, classIds: ["mage", "warrior"], sort: "class", direction: "asc" })));
    expect(result.current.currentPage).toBe(1);
  });

  it("restores and persists roster audio preferences", async () => {
    localStorage.setItem("roster.audio.muted", "true");
    localStorage.setItem("roster.audio.volume", "64");
    const { result } = renderController();
    expect(result.current.audioMuted).toBe(true);
    expect(result.current.audioVolume).toBe(64);
    act(() => { result.current.setAudioMutedState(false); result.current.setAudioVolumeState(36); });
    await waitFor(() => {
      expect(localStorage.getItem("roster.audio.muted")).toBe("false");
      expect(localStorage.getItem("roster.audio.volume")).toBe("36");
    });
  });
});
