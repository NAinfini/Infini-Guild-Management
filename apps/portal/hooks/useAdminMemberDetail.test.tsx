import { permissionSetToRecord, type MemberAvailability } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRow } from "../types/admin";
import { useAdminMemberDetail } from "./useAdminMemberDetail";

const confirmMock = vi.hoisted(() => vi.fn());
const memberMediaControllerMock = vi.hoisted(() => vi.fn((_input: unknown) => ({})));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("./useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("../components/feature/admin/useAdminMemberMediaController", () => ({
  useAdminMemberMediaController: memberMediaControllerMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function member(id: string, display_name: string, bio: string): AdminUserRow {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    user: {
      id,
      display_name,
      role: "member",
      role_name: "Member",
      role_color: null,
      role_level: 1,
      permissions: permissionSetToRecord(new Set()),
      is_active: true,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp,
      last_login_at: null,
    },
    profile: {
      user_id: id,
      power: 10,
      classes: ["warrior"],
      title_html: null,
      bio,
      avatar_media_id: null,
      images: [],
      audio_media_id: null,
      audio_name: null,
      video_urls: [],
      availability: null,
      vacation_start: null,
      vacation_end: null,
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    badges: [],
    edit_revisions: {
      user_revision_token: `${id}-user-v1`,
      profile_revision_token: `${id}-profile-v1`,
    },
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
    memberMediaControllerMock.mockClear();
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
    act(() => result.current.markMemberDetailSaved(alice.user.id, result.current.memberDetailForm, {
      user_revision_token: "alice-id-user-v2",
      profile_revision_token: "alice-id-profile-v2",
    }));
    expect(result.current.isDirty).toBe(false);
    expect(result.current.memberDetailRevisions).toEqual({
      user_revision_token: "alice-id-user-v2",
      profile_revision_token: "alice-id-profile-v2",
    });
  });

  it("keeps the form-open revisions when an A/B refetch arrives behind a dirty draft", async () => {
    const alice = member("alice-id", "Alice", "server bio");
    const { result, rerender } = renderHook(
      ({ usersData }) => useAdminMemberDetail({ usersData, memberSearchParam: undefined, showError: vi.fn() }),
      { initialProps: { usersData: [alice] }, wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.setMemberDetailId(alice.user.id);
    });
    await waitFor(() => expect(result.current.memberDetailRevisions).toEqual({
      user_revision_token: "alice-id-user-v1",
      profile_revision_token: "alice-id-profile-v1",
    }));
    act(() => result.current.setMemberDetailForm((current) => ({ ...current, bio: "A draft" })));

    rerender({ usersData: [{
      ...member("alice-id", "Alice", "B update"),
      edit_revisions: {
        user_revision_token: "alice-id-user-v2",
        profile_revision_token: "alice-id-profile-v2",
      },
    }] });

    expect(result.current.memberDetailForm.bio).toBe("A draft");
    expect(result.current.memberDetailRevisions).toEqual({
      user_revision_token: "alice-id-user-v1",
      profile_revision_token: "alice-id-profile-v1",
    });
  });

  it("adopts clean self refreshes, ignores a known superseded response, and freezes a dirty draft", async () => {
    const alice = member("alice-id", "Alice", "server bio");
    const { result, rerender } = renderHook(
      ({ usersData }) => useAdminMemberDetail({
        usersData,
        memberSearchParam: undefined,
        currentUserId: "alice-id",
        showError: vi.fn(),
      }),
      { initialProps: { usersData: [alice] }, wrapper: wrapper() },
    );

    await act(async () => {
      await result.current.setMemberDetailId(alice.user.id);
    });
    await waitFor(() => expect(result.current.memberDetailRevisions?.profile_revision_token).toBe("alice-id-profile-v1"));
    const controllerInput = memberMediaControllerMock.mock.calls.at(-1)?.[0] as unknown as {
      currentUserId?: string;
      profileRevisionToken?: string | null;
      onProfileRevision?: (memberId: string, profileRevisionToken: string) => void;
    };
    expect(controllerInput.currentUserId).toBe("alice-id");
    expect(controllerInput.profileRevisionToken).toBe("alice-id-profile-v1");

    act(() => controllerInput.onProfileRevision?.("alice-id", "alice-id-profile-v2"));
    await waitFor(() => expect(result.current.memberDetailRevisions?.profile_revision_token).toBe("alice-id-profile-v2"));

    rerender({ usersData: [{
      ...member("alice-id", "Alice", "late stale bio"),
      edit_revisions: {
        user_revision_token: "alice-id-user-v1",
        profile_revision_token: "alice-id-profile-v1",
      },
    }] });
    expect(result.current.memberDetailRevisions?.profile_revision_token).toBe("alice-id-profile-v2");

    rerender({ usersData: [{
      ...member("alice-id", "Alice", "fresh background bio"),
      edit_revisions: {
        user_revision_token: "alice-id-user-v3",
        profile_revision_token: "alice-id-profile-v3",
      },
    }] });
    await waitFor(() => expect(result.current.memberDetailRevisions?.profile_revision_token).toBe("alice-id-profile-v3"));

    act(() => result.current.setMemberDetailForm((current) => ({ ...current, bio: "local draft" })));
    rerender({ usersData: [{
      ...member("alice-id", "Alice", "later background bio"),
      edit_revisions: {
        user_revision_token: "alice-id-user-v4",
        profile_revision_token: "alice-id-profile-v4",
      },
    }] });

    expect(result.current.memberDetailRevisions?.profile_revision_token).toBe("alice-id-profile-v3");
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

  it("includes display name and weekly availability in the editable draft", async () => {
    const alice = member("alice-id", "Alice", "Alice bio");
    const usersData = [alice];
    const availability: MemberAvailability = {
      timezone: "UTC",
      days: {
        sunday: [],
        monday: [{ start_utc: "20:00", end_utc: "22:00" }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      },
    };
    const { result } = renderHook(
      () => useAdminMemberDetail({ usersData, memberSearchParam: undefined, showError: vi.fn() }),
      { wrapper: wrapper() },
    );

    await act(async () => {
      await result.current.setMemberDetailId(alice.user.id);
    });
    await waitFor(() => expect(result.current.memberDetailForm.displayName).toBe("Alice"));
    act(() => result.current.setMemberDetailForm((current) => ({
      ...current,
      displayName: "Alicia",
      availability,
    })));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.resetMemberDetailForm());
    expect(result.current.memberDetailForm).toMatchObject({
      displayName: "Alice",
      availability: null,
    });
  });

});
