import type { MemberProfile, User } from "@guild/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterEntry } from "./useRosterPageController";
import { useRosterPageController } from "./useRosterPageController";

const queryState = vi.hoisted(() => ({ data: undefined as { data: RosterEntry[] } | undefined }));
const stopAudioMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const fetchAllUsersListWithOptionsMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    useQueryMock(options);
    return { data: queryState.data, isLoading: false, isError: false };
  },
}));

vi.mock("./useDebouncedSearch", () => ({
  useDebouncedSearch: () => ({ search: "", setSearch: vi.fn(), debouncedSearch: "" }),
}));

vi.mock("./useExternalView", () => ({ useExternalView: () => false }));
vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({ canManage: () => false }),
}));
vi.mock("../stores/auth", () => ({ useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
vi.mock("../services/UserService", () => ({
  fetchAllUsersListWithOptions: fetchAllUsersListWithOptionsMock,
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
vi.mock("../utils/media", () => ({ resolveProfileMediaUrl: (key: string) => key }));

function row(bio: string, power: number): RosterEntry {
  return {
    user: { id: "user-1", display_name: "Alice", role: "member", is_active: true } as User,
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

describe("useRosterPageController", () => {
  beforeEach(() => {
    localStorage.clear();
    stopAudioMock.mockReset();
    useQueryMock.mockReset();
    fetchAllUsersListWithOptionsMock.mockReset();
    queryState.data = { data: [row("old bio", 10)] };
  });

  it("uses the public projection and public page size for a guest roster", async () => {
    const { result } = renderHook(() => useRosterPageController());

    const rosterQuery = useQueryMock.mock.calls[0]?.[0] as {
      queryKey: readonly unknown[];
      queryFn: () => Promise<unknown>;
    };
    expect(rosterQuery.queryKey).toEqual(["users", "roster", "external"]);

    await rosterQuery.queryFn();
    expect(fetchAllUsersListWithOptionsMock).toHaveBeenCalledWith({ externalView: true });
    expect(result.current.isExternalView).toBe(false);
  });

  it("derives the open member from the latest query rows", () => {
    const { result, rerender } = renderHook(() => useRosterPageController());
    act(() => result.current.openMemberProfile(result.current.sortedRows[0]!));
    expect(result.current.selected?.profile.bio).toBe("old bio");

    queryState.data = { data: [row("refetched bio", 99)] };
    rerender();

    expect(result.current.selected?.profile.bio).toBe("refetched bio");
    expect(result.current.selected?.profile.power).toBe(99);
  });

  it("restores and persists roster audio preferences without a UI-library storage hook", async () => {
    localStorage.setItem("roster.audio.muted", "true");
    localStorage.setItem("roster.audio.volume", "64");

    const { result } = renderHook(() => useRosterPageController());

    expect(result.current.audioMuted).toBe(true);
    expect(result.current.audioVolume).toBe(64);

    act(() => {
      result.current.setAudioMutedState(false);
      result.current.setAudioVolumeState(36);
    });

    await waitFor(() => {
      expect(localStorage.getItem("roster.audio.muted")).toBe("false");
      expect(localStorage.getItem("roster.audio.volume")).toBe("36");
    });
  });
});
