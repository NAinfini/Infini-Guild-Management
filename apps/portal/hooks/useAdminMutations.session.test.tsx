import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminMutations } from "./useAdminMutations";
import { localDayStartIso } from "../utils/datetime";

const serviceMocks = vi.hoisted(() => ({
  batchDeactivateAdminUsers: vi.fn(),
  batchDeleteAdminUsers: vi.fn(),
  batchReactivateAdminUsers: vi.fn(),
  batchUpdateAdminUserRole: vi.fn(),
  createAdminInviteLink: vi.fn(),
  createAdminMember: vi.fn(),
  createRole: vi.fn(),
  deactivateAdminUser: vi.fn(),
  deleteAdminInviteLink: vi.fn(),
  deleteRole: vi.fn(),
  downloadAdminAuditLogExport: vi.fn(),
  reactivateAdminUser: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  revokeAdminInviteLink: vi.fn(),
  updateAdminMember: vi.fn(),
  updateAdminUserRole: vi.fn(),
  updateRole: vi.fn(),
}));
const revalidateSessionSnapshotMock = vi.hoisted(() => vi.fn());
const showErrorMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());
const notifyWarningMock = vi.hoisted(() => vi.fn());

vi.mock("../services/AdminService", () => serviceMocks);
vi.mock("../session-transition", () => ({
  revalidateSessionSnapshot: revalidateSessionSnapshotMock,
}));
vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { seconds?: number }) =>
      options?.seconds === undefined ? key : `${key}:${options.seconds}`,
  }),
}));
vi.mock("../utils/notifications", () => ({
  notifySuccess: notifySuccessMock,
  notifyWarning: notifyWarningMock,
  notifyError: vi.fn(),
}));
vi.mock("../utils/copy", () => ({ copyPlainText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../utils/admin", () => ({
  auditExportDatePart: (value: string) => value || "all",
  downloadFileBlob: vi.fn(),
}));

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderMutations(auditFilter = {
  search: "",
  dateFrom: "",
  dateTo: "",
  entityType: "",
  entityId: "",
  actorId: "",
}) {
  return renderHook(() => useAdminMutations({
    auditFilter,
    batchSelectionLimit: 50,
    showError: showErrorMock,
    resolveUsername: (id) => id,
  }), { wrapper: createWrapper() });
}

describe("useAdminMutations session revalidation", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
      mock.mockResolvedValue({});
    }
    revalidateSessionSnapshotMock.mockReset();
    revalidateSessionSnapshotMock.mockResolvedValue(null);
    showErrorMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    notifySuccessMock.mockReset();
    notifyWarningMock.mockReset();
  });

  it("revalidates after every successful role, status, and role-config mutation", async () => {
    const { result } = renderMutations();

    await act(async () => {
      await result.current.updateRoleMutation.mutateAsync({ userId: "user-1", role: "moderator" });
      await result.current.deactivateMutation.mutateAsync("user-1");
      await result.current.reactivateMutation.mutateAsync("user-1");
      await result.current.batchRoleMutation.mutateAsync({ userIds: ["user-1"], newRole: "member" });
      await result.current.batchDeactivateMutation.mutateAsync(["user-1"]);
      await result.current.batchReactivateMutation.mutateAsync(["user-1"]);
      await result.current.updateMemberProfileMutation.mutateAsync({
        userId: "user-1",
        expectedUserRevisionToken: "user-v1",
        expectedProfileRevisionToken: "profile-v1",
        displayName: "RenamedMember",
        profile: {
          power: 10,
          classes: ["warrior"],
          titleHtml: "",
          bio: "",
          availability: null,
          notes: "",
        },
        role: "member",
        isActive: true,
      });
      await result.current.createRoleMutation.mutateAsync({ name: "Raid Lead", level: 200 });
      await result.current.updateRoleConfigMutation.mutateAsync({
        id: "raid-lead",
        payload: { expected_revision_token: "role-v1", level: 201 },
      });
      await result.current.deleteRoleMutation.mutateAsync("raid-lead");
    });

    expect(revalidateSessionSnapshotMock).toHaveBeenCalledTimes(10);
    expect(revalidateSessionSnapshotMock.mock.calls.every(([client]) => client instanceof QueryClient)).toBe(true);
    expect(serviceMocks.updateAdminMember).toHaveBeenCalledWith("user-1", {
      expected_user_revision_token: "user-v1",
      expected_profile_revision_token: "profile-v1",
      display_name: "RenamedMember",
      profile: {
        power: 10,
        classes: ["warrior"],
        title_html: null,
        bio: null,
        availability: null,
        notes: null,
      },
      role_id: "member",
      is_active: true,
    });
  });

  it("sends one composite member command for the submitted change", async () => {
    const { result } = renderMutations();

    await act(async () => {
      await result.current.updateMemberProfileMutation.mutateAsync({
        userId: "user-1",
        expectedUserRevisionToken: "user-v1",
        expectedProfileRevisionToken: "profile-v1",
        role: "raid-lead",
      });
    });

    expect(serviceMocks.updateAdminMember).toHaveBeenCalledWith("user-1", {
      expected_user_revision_token: "user-v1",
      expected_profile_revision_token: "profile-v1",
      role_id: "raid-lead",
    });
    expect(serviceMocks.updateAdminUserRole).not.toHaveBeenCalled();
    expect(serviceMocks.reactivateAdminUser).not.toHaveBeenCalled();
    expect(serviceMocks.deactivateAdminUser).not.toHaveBeenCalled();
  });

  it("creates a member and its private notes with one atomic request", async () => {
    serviceMocks.createAdminMember.mockResolvedValueOnce({
      ok: true,
      user_id: "user-2",
      display_name: "New Member",
      temporary_login_name: "new-member",
      temporary_password: "temporary-password",
    });
    const { result } = renderMutations();

    await act(async () => {
      await result.current.createMemberMutation.mutateAsync({
        login_name: "new-member",
        display_name: "New Member",
        notes: "Initial officer note",
        roleId: "member",
      });
    });

    expect(serviceMocks.createAdminMember).toHaveBeenCalledWith({
      login_name: "new-member",
      display_name: "New Member",
      role_id: "member",
      notes: "Initial officer note",
    });
    expect(serviceMocks.updateAdminMember).not.toHaveBeenCalled();
  });

  it("does not revalidate failed or unrelated invite and audit mutations", async () => {
    serviceMocks.updateAdminUserRole.mockRejectedValueOnce(new Error("role failed"));
    serviceMocks.deactivateAdminUser.mockRejectedValueOnce(new Error("status failed"));
    serviceMocks.updateRole.mockRejectedValueOnce(new Error("config failed"));
    serviceMocks.downloadAdminAuditLogExport.mockResolvedValueOnce(new Blob(["audit"]));
    const { result } = renderMutations();

    await act(async () => {
      await expect(result.current.updateRoleMutation.mutateAsync({ userId: "user-1", role: "member" })).rejects.toThrow("role failed");
      await expect(result.current.deactivateMutation.mutateAsync("user-1")).rejects.toThrow("status failed");
      await expect(result.current.updateRoleConfigMutation.mutateAsync({
        id: "member",
        payload: { expected_revision_token: "role-v1", level: 2 },
      })).rejects.toThrow("config failed");
      await result.current.createInviteMutation.mutateAsync({ roleId: "member", maxUses: 1, expiresAt: "" });
      await result.current.exportAuditLogMutation.mutateAsync("csv");
    });

    expect(revalidateSessionSnapshotMock).not.toHaveBeenCalled();
  });

  it("forwards a one-sided audit export date for server-side validation", async () => {
    serviceMocks.downloadAdminAuditLogExport.mockResolvedValueOnce(new Blob(["audit"]));
    const { result } = renderMutations({
      search: "",
      dateFrom: "2026-03-08",
      dateTo: "",
      entityType: "",
      entityId: "",
      actorId: "",
    });

    await act(async () => {
      await result.current.exportAuditLogMutation.mutateAsync("csv");
    });

    expect(serviceMocks.downloadAdminAuditLogExport).toHaveBeenCalledWith(expect.objectContaining({
      format: "csv",
      start_at: localDayStartIso("2026-03-08"),
      end_at: undefined,
    }));
  });

  it("keeps a saved mutation successful when only session refresh fails", async () => {
    revalidateSessionSnapshotMock.mockRejectedValueOnce(new Error("session refresh failed"));
    const { result } = renderMutations();

    await act(async () => {
      await result.current.updateRoleMutation.mutateAsync({ userId: "user-1", role: "moderator" });
    });

    await waitFor(() => {
      expect(result.current.updateRoleMutation.isSuccess).toBe(true);
    });
    expect(showErrorMock).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(notifyWarningMock).toHaveBeenCalledWith("message.sessionRefreshFailed");
    });
  });

});
