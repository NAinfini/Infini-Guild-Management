// @vitest-environment jsdom
import { permissionSetToRecord } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRow } from "../types/admin";
import { useAdminMemberDetail } from "./useAdminMemberDetail";

const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("./useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("../components/feature/admin/useAdminMemberMediaController", () => ({
  useAdminMemberMediaController: () => ({}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function member(id: string, username: string, bio: string): AdminUserRow {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    user: {
      id,
      username,
      role: "member",
      permissions: permissionSetToRecord(new Set()),
      is_active: true,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    profile: {
      id: `profile-${id}`,
      user_id: id,
      power: 10,
      classes: ["warrior"],
      title_html: null,
      bio,
      avatar_key: null,
      images: [],
      audio_key: null,
      video_urls: [],
      availability: null,
      vacation_start: null,
      vacation_end: null,
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    badges: [],
  };
}

function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useAdminMemberDetail", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  it("preserves a dirty form when the selected member refetches", async () => {
    const alice = member("alice-id", "Alice", "server bio");
    const { result, rerender } = renderHook(
      ({ usersData }) => useAdminMemberDetail({
        usersData,
        memberSearchParam: undefined,
        showError: vi.fn(),
      }),
      { initialProps: { usersData: [alice] }, wrapper: wrapper() },
    );

    await act(async () => {
      await result.current.setMemberDetailId(alice.user.id);
    });
    await waitFor(() => expect(result.current.memberDetailForm.bio).toBe("server bio"));
    act(() => result.current.setMemberDetailForm((current) => ({ ...current, bio: "local draft" })));
    expect(result.current.isDirty).toBe(true);

    rerender({ usersData: [member("alice-id", "Alice", "refetched bio")] });

    expect(result.current.memberDetailForm.bio).toBe("local draft");
    expect(result.current.isDirty).toBe(true);
  });

  it("syncs clean refetches and treats a successful save as the new baseline", async () => {
    const alice = member("alice-id", "Alice", "first bio");
    const { result, rerender } = renderHook(
      ({ usersData }) => useAdminMemberDetail({
        usersData,
        memberSearchParam: undefined,
        showError: vi.fn(),
      }),
      { initialProps: { usersData: [alice] }, wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.setMemberDetailId(alice.user.id);
    });
    await waitFor(() => expect(result.current.memberDetailForm.bio).toBe("first bio"));

    rerender({ usersData: [member("alice-id", "Alice", "clean refetch")] });
    await waitFor(() => expect(result.current.memberDetailForm.bio).toBe("clean refetch"));

    act(() => result.current.setMemberDetailForm((current) => ({ ...current, bio: "saved draft" })));
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.markMemberDetailSaved(alice.user.id, result.current.memberDetailForm));
    expect(result.current.isDirty).toBe(false);
  });

  it("tracks repeated member query changes including clear and reopen", async () => {
    const usersData = [member("alice-id", "Alice", "Alice bio"), member("bob-id", "Bob", "Bob bio")];
    const { result, rerender } = renderHook(
      ({ memberSearchParam }) => useAdminMemberDetail({ usersData, memberSearchParam, showError: vi.fn() }),
      { initialProps: { memberSearchParam: "Alice" as string | undefined }, wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.memberDetailId).toBe("alice-id"));
    rerender({ memberSearchParam: "Bob" });
    await waitFor(() => expect(result.current.memberDetailId).toBe("bob-id"));
    rerender({ memberSearchParam: undefined });
    await waitFor(() => expect(result.current.memberDetailId).toBeNull());
    rerender({ memberSearchParam: "Alice" });
    await waitFor(() => expect(result.current.memberDetailId).toBe("alice-id"));
  });

  it("requires confirmation before switching away from a dirty member", async () => {
    const usersData = [member("alice-id", "Alice", "Alice bio"), member("bob-id", "Bob", "Bob bio")];
    const { result } = renderHook(
      () => useAdminMemberDetail({ usersData, memberSearchParam: undefined, showError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.setMemberDetailId("alice-id");
    });
    await waitFor(() => expect(result.current.memberDetailForm.bio).toBe("Alice bio"));
    act(() => result.current.setMemberDetailForm((current) => ({ ...current, bio: "draft" })));
    confirmMock.mockResolvedValueOnce(false);

    await act(async () => {
      await result.current.setMemberDetailId("bob-id");
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(result.current.memberDetailId).toBe("alice-id");
  });
});
