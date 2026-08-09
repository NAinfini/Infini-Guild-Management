// @vitest-environment jsdom
import type { MemberProfile, User } from "@guild/shared";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterEntry } from "./useRosterPageController";
import { useRosterPageController } from "./useRosterPageController";

const queryState = vi.hoisted(() => ({ data: undefined as { data: RosterEntry[] } | undefined }));
const stopAudioMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: queryState.data, isLoading: false, isError: false }),
}));

vi.mock("@mantine/hooks", () => ({
  useLocalStorage: ({ defaultValue }: { defaultValue: unknown }) => useState(defaultValue),
}));

vi.mock("./useDebouncedSearch", () => ({
  useDebouncedSearch: () => ({ search: "", setSearch: vi.fn(), debouncedSearch: "" }),
}));

vi.mock("./useExternalView", () => ({ useExternalView: () => false }));
vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({ canManage: () => false }),
}));
vi.mock("../stores/auth", () => ({ useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
vi.mock("../stores/class-catalog", () => ({
  useClassCatalogStore: (selector: (state: { items: never[] }) => unknown) => selector({ items: [] }),
  resolveClassCatalogItem: (id: string) => ({ label: id }),
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
    user: { id: "user-1", username: "Alice", role: "member", is_active: true } as User,
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
    queryState.data = { data: [row("old bio", 10)] };
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
});
