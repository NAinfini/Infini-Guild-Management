// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminData } from "./useAdminData";
import { useEventsData } from "./useEventsData";
import { useGuildWarData } from "./useGuildWarData";
import { useProfileData } from "./useProfileData";

const serviceMocks = vi.hoisted(() => ({
  fetchAdminAuditArchiveMonths: vi.fn(),
  fetchAdminAuditLog: vi.fn(),
  fetchAdminInviteLinks: vi.fn(),
  fetchAdminInviteStats: vi.fn(),
  fetchAdminStatus: vi.fn(),
  fetchAdminSiteConfig: vi.fn(),
  fetchEventDetail: vi.fn(),
  fetchEventsList: vi.fn(),
  fetchGuildWarActive: vi.fn(),
  fetchGuildWarHistory: vi.fn(),
  fetchGuildWarHistoryDetail: vi.fn(),
  fetchRoles: vi.fn(),
  fetchTemplatesList: vi.fn(),
  fetchUserDetail: vi.fn(),
  fetchAllUsersListWithOptions: vi.fn(),
}));

vi.mock("../../services/EventService", () => ({
  fetchEventDetail: serviceMocks.fetchEventDetail,
  fetchEventsList: serviceMocks.fetchEventsList,
  fetchTemplatesList: serviceMocks.fetchTemplatesList,
}));

vi.mock("../../services/GuildWarService", () => ({
  fetchGuildWarActive: serviceMocks.fetchGuildWarActive,
  fetchGuildWarHistory: serviceMocks.fetchGuildWarHistory,
  fetchGuildWarHistoryDetail: serviceMocks.fetchGuildWarHistoryDetail,
}));

vi.mock("../../services/UserService", () => ({
  fetchAllUsersListWithOptions: serviceMocks.fetchAllUsersListWithOptions,
  fetchUserDetail: serviceMocks.fetchUserDetail,
}));

vi.mock("../../services/AdminService", () => ({
  fetchAdminAuditArchiveMonths: serviceMocks.fetchAdminAuditArchiveMonths,
  fetchAdminAuditLog: serviceMocks.fetchAdminAuditLog,
  fetchAdminInviteLinks: serviceMocks.fetchAdminInviteLinks,
  fetchAdminInviteStats: serviceMocks.fetchAdminInviteStats,
  fetchAdminStatus: serviceMocks.fetchAdminStatus,
  fetchRoles: serviceMocks.fetchRoles,
}));

vi.mock("../../services/SiteConfigService", () => ({
  fetchAdminSiteConfig: serviceMocks.fetchAdminSiteConfig,
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("portal data hooks", () => {
  beforeEach(() => {
    for (const fn of Object.values(serviceMocks)) {
      fn.mockReset();
    }
  });

  it("loads events and users through the service layer", async () => {
    serviceMocks.fetchEventsList.mockResolvedValueOnce({ data: [] });
    serviceMocks.fetchAllUsersListWithOptions.mockResolvedValueOnce({ data: [] });

    const { result } = renderHook(
      () =>
        useEventsData({
          eventType: "social",
          status: "active",
          searchQuery: "guild raid",
          pinnedOnly: true,
          lockedOnly: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.eventsQuery.isSuccess).toBe(true);
      expect(result.current.usersQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchEventsList).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      type: "social",
      archived: false,
      search: "guild raid",
      pinned: true,
      locked: true,
    });
    expect(serviceMocks.fetchAllUsersListWithOptions).toHaveBeenCalled();
  });

  it("loads guild war queries through the service layer", async () => {
    serviceMocks.fetchEventsList.mockResolvedValueOnce({ data: [] });
    serviceMocks.fetchEventDetail.mockResolvedValueOnce({ id: "event-1", title: "Guild War", participants: [], attachments: [] });
    serviceMocks.fetchGuildWarActive.mockResolvedValueOnce({ teams: [], pool: [], etag: "etag-1" });
    serviceMocks.fetchGuildWarHistory.mockResolvedValueOnce({ data: [] });
    serviceMocks.fetchGuildWarHistoryDetail.mockResolvedValueOnce({ id: "history-1", teams: [], pool: [], member_stats: [] });

    const { result } = renderHook(
      () =>
        useGuildWarData({
          selectedEventId: "event-1",
          selectedHistoryId: "history-1",
          historyDateFrom: "2026-03-01",
          historyDateTo: "2026-03-08",
          historySearch: "Dragon",
          historyPage: 1,
          historyPerPage: 20,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.warEventsQuery.isSuccess).toBe(true);
      expect(result.current.selectedEventDetailQuery.isSuccess).toBe(true);
      expect(result.current.activeQuery.isSuccess).toBe(true);
      expect(result.current.historyQuery.isSuccess).toBe(true);
      expect(result.current.historyDetailQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchEventsList).toHaveBeenCalledWith({
      page: 1,
      limit: 100,
      type: "guild_war",
    });
    expect(serviceMocks.fetchEventDetail).toHaveBeenCalledWith("event-1");
    expect(serviceMocks.fetchGuildWarActive).toHaveBeenCalledWith("event-1");
    expect(serviceMocks.fetchGuildWarHistory).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      date_from: "2026-03-01T00:00:00.000Z",
      date_to: "2026-03-08T23:59:59.999Z",
      search: "Dragon",
    });
    expect(serviceMocks.fetchGuildWarHistoryDetail).toHaveBeenCalledWith("history-1");
  });

  it("loads profile detail through the user service", async () => {
    serviceMocks.fetchUserDetail.mockResolvedValueOnce({ id: "user-1" });

    const { result } = renderHook(
      () => useProfileData({ userId: "user-1" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.profileQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchUserDetail).toHaveBeenCalledWith("user-1");
  });

  it("loads only the active admin section while retaining role-based permissions", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([
      {
        id: "admin",
        permissions: {
          "admin.audit.export": true,
          "admin.audit.view": true,
          "admin.badges.manage": true,
          "admin.gameData.manage": true,
          "admin.invite.view": true,
          "admin.roles.manage": true,
          "admin.roles.view": true,
          "admin.status.view": true,
          "admin.users.view": true,
          "admin.siteConfig.manage": true,
        },
      },
    ]);
    serviceMocks.fetchAllUsersListWithOptions.mockResolvedValue({ data: [] });
    serviceMocks.fetchAdminInviteLinks.mockImplementation(
      ({ cursor }: { cursor?: string }) => Promise.resolve({
        data: [],
        next_cursor: cursor ? null : "50",
        total: 75,
      }),
    );
    serviceMocks.fetchAdminInviteStats.mockResolvedValue({});
    serviceMocks.fetchAdminAuditLog.mockResolvedValue({ data: [] });
    serviceMocks.fetchAdminAuditArchiveMonths.mockResolvedValue([]);
    serviceMocks.fetchAdminStatus.mockResolvedValue({});
    serviceMocks.fetchAdminSiteConfig.mockResolvedValue({ site: {} });

    const { result, rerender } = renderHook(
      ({
        activeTab,
        inviteVisibility,
        inviteSearch,
      }: {
        activeTab: string;
        inviteVisibility: "active" | "expired" | "revoked";
        inviteSearch: string;
      }) =>
        useAdminData({
          isModerator: true,
          userRole: "admin",
          activeTab,
          auditPage: 2,
          auditSearch: "raid",
          auditDateFrom: "2026-03-01",
          auditDateTo: "2026-03-08",
          auditEntityType: "",
          auditActorId: "",
          inviteVisibility,
          inviteSearch,
        }),
      {
        initialProps: {
          activeTab: "status",
          inviteVisibility: "active" as "active" | "expired" | "revoked",
          inviteSearch: "",
        },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
      expect(result.current.statusQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchRoles).toHaveBeenCalled();
    expect(serviceMocks.fetchAdminStatus).toHaveBeenCalled();
    expect(serviceMocks.fetchAllUsersListWithOptions).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteLinks).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminAuditLog).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminSiteConfig).not.toHaveBeenCalled();

    rerender({ activeTab: "invite", inviteVisibility: "active", inviteSearch: "" });
    await waitFor(() => {
      expect(result.current.inviteLinksQuery.isSuccess).toBe(true);
      expect(result.current.inviteStatsQuery.isSuccess).toBe(true);
    });
    expect(serviceMocks.fetchAdminInviteLinks).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 50,
      visibility: "active",
      search: undefined,
    });
    await act(async () => {
      await result.current.inviteLinksQuery.fetchNextPage();
    });
    expect(serviceMocks.fetchAdminInviteLinks).toHaveBeenCalledWith({
      cursor: "50",
      limit: 50,
      visibility: "active",
      search: undefined,
    });

    rerender({
      activeTab: "invite",
      inviteVisibility: "expired",
      inviteSearch: "2026-07",
    });
    await waitFor(() => {
      expect(serviceMocks.fetchAdminInviteLinks).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 50,
        visibility: "expired",
        search: "2026-07",
      });
    });

    rerender({ activeTab: "audit", inviteVisibility: "expired", inviteSearch: "2026-07" });
    await waitFor(() => {
      expect(result.current.usersQuery.isSuccess).toBe(true);
      expect(result.current.auditLogQuery.isSuccess).toBe(true);
      expect(result.current.auditMonthsQuery.isSuccess).toBe(true);
    });
    expect(serviceMocks.fetchAdminAuditLog).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      search: "raid",
      start_at: "2026-03-01T00:00:00.000Z",
      end_at: "2026-03-08T23:59:59.999Z",
    });

    rerender({ activeTab: "siteConfig", inviteVisibility: "expired", inviteSearch: "2026-07" });
    await waitFor(() => {
      expect(result.current.siteConfigQuery.isSuccess).toBe(true);
    });
    expect(serviceMocks.fetchAdminSiteConfig).toHaveBeenCalled();
    expect(result.current.permissions).toEqual({
      canAccessAdmin: true,
      canViewUsers: true,
      canViewInvites: true,
      canViewAudit: true,
      canExportAudit: true,
      canViewRoles: true,
      canManageRoles: true,
      canViewStatus: true,
      canManageBadges: true,
      canManageGameData: true,
      canManageSiteConfig: true,
    });
  });

  it("does not fetch unrelated admin sections without exact permissions", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([
      {
        id: "status-only",
        permissions: {
          "admin.status.view": true,
        },
      },
    ]);
    serviceMocks.fetchAdminStatus.mockResolvedValueOnce({});

    const { result } = renderHook(
      () =>
        useAdminData({
          isModerator: true,
          userRole: "status-only",
          activeTab: "status",
          auditPage: 1,
          auditSearch: "",
          auditDateFrom: "",
          auditDateTo: "",
          auditEntityType: "",
          auditActorId: "",
          inviteVisibility: "active",
          inviteSearch: "",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
      expect(result.current.statusQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchAllUsersListWithOptions).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteLinks).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteStats).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminAuditLog).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminAuditArchiveMonths).not.toHaveBeenCalled();
    expect(result.current.permissions).toEqual({
      canAccessAdmin: true,
      canViewUsers: false,
      canViewInvites: false,
      canViewAudit: false,
      canExportAudit: false,
      canViewRoles: false,
      canManageRoles: false,
      canViewStatus: true,
      canManageBadges: false,
      canManageGameData: false,
      canManageSiteConfig: false,
    });
  });

  it("treats roles-view-only permission as admin access without enabling unrelated queries", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([
      {
        id: "roles-view-only",
        permissions: {
          "admin.roles.view": true,
        },
      },
    ]);

    const { result } = renderHook(
      () =>
        useAdminData({
          isModerator: true,
          userRole: "roles-view-only",
          activeTab: "roles",
          auditPage: 1,
          auditSearch: "",
          auditDateFrom: "",
          auditDateTo: "",
          auditEntityType: "",
          auditActorId: "",
          inviteVisibility: "active",
          inviteSearch: "",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchAllUsersListWithOptions).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteLinks).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteStats).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminAuditLog).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminAuditArchiveMonths).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminStatus).not.toHaveBeenCalled();
    expect(result.current.permissions).toEqual({
      canAccessAdmin: true,
      canViewUsers: false,
      canViewInvites: false,
      canViewAudit: false,
      canExportAudit: false,
      canViewRoles: true,
      canManageRoles: false,
      canViewStatus: false,
      canManageBadges: false,
      canManageGameData: false,
      canManageSiteConfig: false,
    });
  });

  it("starts admin section queries from effective permissions before role configuration finishes loading", async () => {
    serviceMocks.fetchRoles.mockImplementationOnce(() => new Promise(() => undefined));
    serviceMocks.fetchAdminSiteConfig.mockResolvedValueOnce({ site: {} });

    const { result } = renderHook(
      () =>
        useAdminData({
          isModerator: true,
          userRole: "admin",
          activeTab: "siteConfig",
          auditPage: 1,
          auditSearch: "",
          auditDateFrom: "",
          auditDateTo: "",
          auditEntityType: "",
          auditActorId: "",
          inviteVisibility: "active",
          inviteSearch: "",
          effectivePermissions: {
            canAccessAdmin: true,
            canViewUsers: true,
            canViewInvites: false,
            canViewAudit: false,
            canExportAudit: false,
            canViewRoles: false,
            canManageRoles: false,
            canViewStatus: false,
            canManageBadges: false,
            canManageGameData: false,
            canManageSiteConfig: true,
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.siteConfigQuery.isSuccess).toBe(true);
    });

    expect(result.current.rolesQuery.isLoading).toBe(true);
    expect(serviceMocks.fetchAllUsersListWithOptions).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminSiteConfig).toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteLinks).not.toHaveBeenCalled();
  });
});
