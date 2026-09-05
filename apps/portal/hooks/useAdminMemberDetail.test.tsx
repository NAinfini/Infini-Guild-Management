import type { MemberAvailability } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { queryKeys } from "../api/query-keys";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRow } from "../types/admin";
import { useAdminMemberDetail } from "./useAdminMemberDetail";

const detailResponses = new Map<string, AdminUserRow>();
const fetchUserDetailMock = vi.hoisted(() => vi.fn());
vi.mock("../services/UserService", () => ({ fetchUserDetail: fetchUserDetailMock }));
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

function renderDetail(rows: AdminUserRow[], currentUserId = "admin-id", initialMemberId?: string) {
  rows.forEach((row) => detailResponses.set(row.user.id, row));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook(
    ({ memberSearchParam }) => useAdminMemberDetail({ memberSearchParam, currentUserId, showError: vi.fn() }),
    { initialProps: { memberSearchParam: initialMemberId as string | undefined }, wrapper },
  );
  return {
    ...hook,
    queryClient,
    select: async (id: string) => {
      await act(async () => { await hook.result.current.setMemberDetailId(id); });
      await waitFor(() => expect(hook.result.current.selectedMemberDetail?.user.id).toBe(id));
    },
    refresh: async (row: AdminUserRow) => {
      detailResponses.set(row.user.id, row);
      await act(async () => { await hook.result.current.memberDetailQuery.refetch(); });
      await waitFor(() => expect(hook.result.current.memberDetailQuery.data).toEqual(row));
    },
  };
}

describe("useAdminMemberDetail", () => {
  beforeEach(() => {
    detailResponses.clear();
    fetchUserDetailMock.mockReset();
    fetchUserDetailMock.mockImplementation(async (id: string) => {
      const row = detailResponses.get(id);
      if (!row) throw new Error("Not found");
      return structuredClone(row);
    });
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    memberMediaControllerMock.mockClear();
  });

  it("loads a stable member ID independently of the paginated list and follows repeated deep links", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "Alice bio"), member("bob-id", "Bob", "Bob bio")], "admin-id", "alice-id");
    await waitFor(() => expect(hook.result.current.memberDetailForm.bio).toBe("Alice bio"));
    expect(fetchUserDetailMock).toHaveBeenCalledWith("alice-id", { signal: expect.any(AbortSignal) });
    expect(hook.queryClient.getQueryData(queryKeys.users.detail("user:admin-id", "internal", "alice-id"))).toBeDefined();
    hook.rerender({ memberSearchParam: "bob-id" });
    await waitFor(() => expect(hook.result.current.memberDetailForm.bio).toBe("Bob bio"));
    hook.rerender({ memberSearchParam: undefined });
    await waitFor(() => expect(hook.result.current.memberDetailId).toBeNull());
    hook.rerender({ memberSearchParam: "alice-id" });
    await waitFor(() => expect(hook.result.current.memberDetailForm.bio).toBe("Alice bio"));
  });

  it("keeps the form-open revisions and dirty draft when a newer detail refetch arrives", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "server bio")]);
    await hook.select("alice-id");
    act(() => hook.result.current.setMemberDetailForm((form) => ({ ...form, bio: "local draft" })));
    await hook.refresh({ ...member("alice-id", "Alice", "refetched bio"), edit_revisions: { user_revision_token: "user-v2", profile_revision_token: "profile-v2" } });
    expect(hook.result.current.memberDetailForm.bio).toBe("local draft");
    expect(hook.result.current.isDirty).toBe(true);
    expect(hook.result.current.memberDetailRevisions).toEqual({ user_revision_token: "alice-id-user-v1", profile_revision_token: "alice-id-profile-v1" });
  });

  it("syncs a clean detail refetch and uses a successful save as the new baseline", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "first bio")]);
    await hook.select("alice-id");
    await hook.refresh(member("alice-id", "Alice", "clean refetch"));
    expect(hook.result.current.memberDetailForm.bio).toBe("clean refetch");
    act(() => hook.result.current.setMemberDetailForm((form) => ({ ...form, bio: "saved draft" })));
    act(() => hook.result.current.markMemberDetailSaved("alice-id", hook.result.current.memberDetailForm, { user_revision_token: "user-v2", profile_revision_token: "profile-v2" }));
    expect(hook.result.current.isDirty).toBe(false);
    act(() => hook.result.current.setMemberDetailForm((form) => ({ ...form, bio: "discard this" })));
    act(() => hook.result.current.resetMemberDetailForm());
    expect(hook.result.current.memberDetailForm.bio).toBe("saved draft");
    expect(hook.result.current.memberDetailRevisions?.profile_revision_token).toBe("profile-v2");
  });

  it("accepts media revisions, rejects a superseded response, and freezes a subsequent dirty draft", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "server bio")], "alice-id");
    await hook.select("alice-id");
    const input = memberMediaControllerMock.mock.calls.at(-1)?.[0] as { currentUserId: string; onProfileRevision: (id: string, revision: string) => void };
    expect(input.currentUserId).toBe("alice-id");
    act(() => input.onProfileRevision("alice-id", "profile-v2"));
    await hook.refresh(member("alice-id", "Alice", "stale bio"));
    expect(hook.result.current.memberDetailForm.bio).toBe("server bio");
    expect(hook.result.current.memberDetailRevisions?.profile_revision_token).toBe("profile-v2");
    await hook.refresh({ ...member("alice-id", "Alice", "fresh bio"), edit_revisions: { user_revision_token: "user-v3", profile_revision_token: "profile-v3" } });
    expect(hook.result.current.memberDetailForm.bio).toBe("fresh bio");
    act(() => hook.result.current.setMemberDetailForm((form) => ({ ...form, bio: "draft" })));
    await hook.refresh({ ...member("alice-id", "Alice", "later bio"), edit_revisions: { user_revision_token: "user-v4", profile_revision_token: "profile-v4" } });
    expect(hook.result.current.memberDetailRevisions?.profile_revision_token).toBe("profile-v3");
  });

  it("requires confirmation before switching away from a dirty member", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "Alice bio"), member("bob-id", "Bob", "Bob bio")]);
    await hook.select("alice-id");
    act(() => hook.result.current.setMemberDetailForm((form) => ({ ...form, bio: "draft" })));
    confirmMock.mockResolvedValueOnce(false);
    await act(async () => { expect(await hook.result.current.setMemberDetailId("bob-id")).toBe(false); });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.memberDetailId).toBe("alice-id");
  });

  it("retains pending media ownership while an upload is in flight", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "Alice bio")]);
    await hook.select("alice-id");
    const input = memberMediaControllerMock.mock.calls.at(-1)?.[0] as { onMediaStateChange: (state: unknown) => void };
    const discard = vi.fn();
    act(() => input.onMediaStateChange({ memberId: "alice-id", hasPendingChanges: true, isInFlight: true, discardPendingChanges: discard }));
    await act(async () => { expect(await hook.result.current.setMemberDetailId(null)).toBe(false); });
    expect(discard).not.toHaveBeenCalled();
    expect(hook.result.current.memberDetailId).toBe("alice-id");
  });

  it("includes display name and weekly availability in the editable draft", async () => {
    const hook = renderDetail([member("alice-id", "Alice", "Alice bio")]);
    await hook.select("alice-id");
    const availability: MemberAvailability = { timezone: "UTC", days: { sunday: [], monday: [{ start_utc: "20:00", end_utc: "22:00" }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] } };
    act(() => hook.result.current.setMemberDetailForm((form) => ({ ...form, displayName: "Alicia", availability })));
    expect(hook.result.current.isDirty).toBe(true);
    act(() => hook.result.current.resetMemberDetailForm());
    expect(hook.result.current.memberDetailForm).toMatchObject({ displayName: "Alice", availability: null });
  });
});
