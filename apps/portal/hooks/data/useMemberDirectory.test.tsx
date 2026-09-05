import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberDirectory } from "./useMemberDirectory";

const serviceMocks = vi.hoisted(() => ({
  fetchMemberDirectory: vi.fn(),
  fetchMemberIdentities: vi.fn(),
  fetchMemberPlanning: vi.fn(),
  fetchMemberAvailabilitySummary: vi.fn(),
}));

vi.mock("../../services/UserService", () => serviceMocks);

function member(id: string, display_name: string) {
  return {
    user: { id, display_name },
    profile: { classes: [], power: 0, avatar_media_id: null },
  };
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useMemberDirectory", () => {
  beforeEach(() => {
    serviceMocks.fetchMemberDirectory.mockReset();
    serviceMocks.fetchMemberIdentities.mockReset();
    serviceMocks.fetchMemberPlanning.mockReset();
    serviceMocks.fetchMemberAvailabilitySummary.mockReset();
  });

  it("paginates explicitly and retains selected identities across server searches", async () => {
    serviceMocks.fetchMemberDirectory.mockImplementation(({ search, cursor }: { search?: string; cursor?: string | null }) => {
      if (search === "zo") return Promise.resolve({ data: [member("zoe", "Zoe")], next_cursor: null });
      if (cursor === "page-2") return Promise.resolve({ data: [member("carol", "Carol")], next_cursor: null });
      return Promise.resolve({ data: [member("alice", "Alice")], next_cursor: "page-2" });
    });
    serviceMocks.fetchMemberIdentities.mockResolvedValue({ data: [member("selected", "Selected member")] });

    const { result, rerender } = renderHook(
      ({ search }) => useMemberDirectory({
        currentUserId: "admin-1",
        search,
        selectedIds: ["selected"],
      }),
      { initialProps: { search: "" }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.entries.map((entry) => entry.user.id).sort())
      .toEqual(["alice", "selected"]));
    await act(async () => { await result.current.loadMore(); });
    await waitFor(() => expect(result.current.entries.map((entry) => entry.user.id).sort())
      .toEqual(["alice", "carol", "selected"]));

    rerender({ search: "zo" });
    await waitFor(() => expect(result.current.entries.map((entry) => entry.user.id).sort())
      .toEqual(["selected", "zoe"]));
  });

  it("can fetch only known identities without opening a directory page", async () => {
    serviceMocks.fetchMemberIdentities.mockResolvedValue({ data: [member("known", "Known member")] });

    const { result } = renderHook(() => useMemberDirectory({
      currentUserId: "member-1",
      enabled: false,
      selectedIds: ["known"],
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.entries[0]?.user.id).toBe("known"));
    expect(serviceMocks.fetchMemberDirectory).not.toHaveBeenCalled();
    expect(serviceMocks.fetchMemberIdentities).toHaveBeenCalledWith(
      ["known"],
      expect.objectContaining({ externalView: false, signal: expect.any(AbortSignal) }),
    );
  });

  it("retries an initial directory failure without reporting an empty directory", async () => {
    serviceMocks.fetchMemberDirectory.mockRejectedValueOnce(new Error("503"));

    const { result } = renderHook(() => useMemberDirectory({ currentUserId: "admin-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loadError?.kind).toBe("directory"));
    expect(result.current.isDirectoryUnavailable).toBe(true);

    serviceMocks.fetchMemberDirectory.mockResolvedValueOnce({
      data: [member("alice", "Alice")],
      next_cursor: null,
    });
    await act(async () => { await result.current.loadError?.retry(); });

    await waitFor(() => expect(result.current.entries[0]?.user.id).toBe("alice"));
    expect(result.current.loadError).toBeNull();
  });

  it("keeps loaded pages while retrying a failed next page", async () => {
    serviceMocks.fetchMemberDirectory
      .mockResolvedValueOnce({ data: [member("alice", "Alice")], next_cursor: "page-2" })
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ data: [member("bob", "Bob")], next_cursor: null });

    const { result } = renderHook(() => useMemberDirectory({ currentUserId: "admin-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.entries.map((entry) => entry.user.id)).toEqual(["alice"]));
    await act(async () => { await result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadError?.kind).toBe("next-page"));
    expect(result.current.entries.map((entry) => entry.user.id)).toEqual(["alice"]);

    await act(async () => { await result.current.loadError?.retry(); });
    await waitFor(() => expect(result.current.entries.map((entry) => entry.user.id)).toEqual(["alice", "bob"]));
  });

  it("retries known identities independently from the directory page", async () => {
    serviceMocks.fetchMemberDirectory.mockResolvedValue({
      data: [member("alice", "Alice")],
      next_cursor: null,
    });
    serviceMocks.fetchMemberIdentities
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ data: [member("selected", "Selected member")] });

    const { result } = renderHook(() => useMemberDirectory({
      currentUserId: "admin-1",
      selectedIds: ["selected"],
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loadError?.kind).toBe("identities"));
    expect(result.current.entries.map((entry) => entry.user.id)).toEqual(["alice"]);

    await act(async () => { await result.current.loadError?.retry(); });
    await waitFor(() => expect(result.current.entries.map((entry) => entry.user.id).sort())
      .toEqual(["alice", "selected"]));
  });
});
