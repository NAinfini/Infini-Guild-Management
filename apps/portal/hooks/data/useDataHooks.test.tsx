import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminData } from "./useAdminData";
import { useEventsData } from "./useEventsData";
import { useGuildWarData } from "./useGuildWarData";
import { useProfileData } from "./useProfileData";
import { queryKeys } from "../../api/query-keys";
import { localDayEndIso, localDayStartIso } from "../../utils/datetime";

const serviceMocks = vi.hoisted(() => ({
  fetchAdminAuditArchiveMonths: vi.fn(),
  fetchAdminAuditLog: vi.fn(),
  fetchAdminInviteLinks: vi.fn(),
  fetchAdminInviteStats: vi.fn(),
  fetchAdminOperations: vi.fn(),
  fetchAdminStatus: vi.fn(),
  fetchAdminSiteConfig: vi.fn(),
  fetchEventsList: vi.fn(),
  fetchGuildWarActive: vi.fn(),
  fetchGuildWarConcludedEventIds: vi.fn(),
  fetchGuildWarHistory: vi.fn(),
  fetchGuildWarHistoryDetail: vi.fn(),
  fetchRoles: vi.fn(),
  fetchTemplatesList: vi.fn(),
  fetchUserDetail: vi.fn(),
  fetchUsersListWithOptions: vi.fn(),
}));

vi.mock("../../services/EventService", () => ({
  fetchEventsList: serviceMocks.fetchEventsList,
  fetchTemplatesList: serviceMocks.fetchTemplatesList,
}));

vi.mock("../../services/GuildWarService", () => ({
  fetchGuildWarActive: serviceMocks.fetchGuildWarActive,
  fetchGuildWarConcludedEventIds: serviceMocks.fetchGuildWarConcludedEventIds,
  fetchGuildWarHistory: serviceMocks.fetchGuildWarHistory,
  fetchGuildWarHistoryDetail: serviceMocks.fetchGuildWarHistoryDetail,
}));

vi.mock("../../services/UserService", () => ({
  fetchUsersListWithOptions: serviceMocks.fetchUsersListWithOptions,
  fetchUserDetail: serviceMocks.fetchUserDetail,
}));

vi.mock("../../services/AdminService", () => ({
  fetchAdminAuditArchiveMonths: serviceMocks.fetchAdminAuditArchiveMonths,
  fetchAdminAuditLog: serviceMocks.fetchAdminAuditLog,
  fetchAdminInviteLinks: serviceMocks.fetchAdminInviteLinks,
  fetchAdminInviteStats: serviceMocks.fetchAdminInviteStats,
  fetchAdminOperations: serviceMocks.fetchAdminOperations,
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

function createWrapper(queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })): ({ children }: { children: ReactNode }) => ReactNode {

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

  it("loads events without coupling the list to a member-directory scan", async () => {
    serviceMocks.fetchEventsList.mockResolvedValueOnce({ data: [] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () =>
        useEventsData({
          eventType: "social",
          status: "active",
          searchQuery: "guild raid",
          pinnedOnly: true,
          lockedOnly: true,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.eventsQuery.isSuccess).toBe(true));

    expect(serviceMocks.fetchEventsList).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      type: "social",
      archived: false,
      search: "guild raid",
      pinned: true,
      locked: true,
    });
    expect(queryClient.getQueryCache().findAll({ queryKey: queryKeys.events.all })[0]?.queryKey).toContain("user:user-1");
    expect(serviceMocks.fetchUsersListWithOptions).not.toHaveBeenCalled();
  });

  it("loads only active guild war queries through the service layer", async () => {
    serviceMocks.fetchEventsList.mockResolvedValueOnce({
      data: [{ id: "event-1", archived_at: null }],
    });
    serviceMocks.fetchGuildWarConcludedEventIds.mockResolvedValueOnce({ data: [] });
    serviceMocks.fetchGuildWarActive.mockResolvedValueOnce({ teams: [], pool: [], etag: "etag-1" });

    const { result } = renderHook(
      () =>
        useGuildWarData({
          tab: "active",
          selectedEventId: "event-1",
          selectedHistoryId: null,
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
      expect(result.current.activeQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchEventsList).toHaveBeenCalledWith({
      page: 1,
      limit: 100,
      type: "guild_war",
      archived: false,
    });
    expect(serviceMocks.fetchGuildWarConcludedEventIds).toHaveBeenCalled();
    expect(serviceMocks.fetchGuildWarActive).toHaveBeenCalledWith("event-1");
    expect(serviceMocks.fetchGuildWarHistory).not.toHaveBeenCalled();
    expect(serviceMocks.fetchGuildWarHistoryDetail).not.toHaveBeenCalled();
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
          "admin.invite.view": true,
          "admin.roles.manage": true,
          "admin.roles.view": true,
          "admin.status.view": true,
          "admin.users.view": true,
          "admin.siteConfig.manage": true,
        },
      },
    ]);
    serviceMocks.fetchUsersListWithOptions.mockResolvedValue({ data: [] });
    serviceMocks.fetchAdminInviteLinks.mockImplementation(
      ({ cursor }: { cursor?: string }) => Promise.resolve({
        data: [],
        next_cursor: cursor ? null : "eyJjcmVhdGVkX2F0IjoiMjAyNi0wNS0xOFQwMDowMDowMC4wMDBaIiwiaWQiOiJpbnZpdGUtNTAifQ",
        total: 75,
      }),
    );
    serviceMocks.fetchAdminInviteStats.mockResolvedValue({});
    serviceMocks.fetchAdminAuditLog.mockResolvedValue({ data: [], next_cursor: null });
    serviceMocks.fetchAdminAuditArchiveMonths.mockResolvedValue([]);
    serviceMocks.fetchAdminOperations.mockResolvedValue({});
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
          auditSearch: "raid",
          auditDateFrom: "2026-03-01",
          auditDateTo: "2026-03-08",
          auditEntityType: "",
          auditEntityId: "",
          auditActorId: "",
          inviteVisibility,
          inviteSearch,
        }),
      {
        initialProps: {
          activeTab: "operations",
          inviteVisibility: "active" as "active" | "expired" | "revoked",
          inviteSearch: "",
        },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
      expect(result.current.statusQuery.isSuccess).toBe(true);
      expect(result.current.operationsQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchRoles).toHaveBeenCalled();
    expect(serviceMocks.fetchAdminStatus).toHaveBeenCalled();
    expect(serviceMocks.fetchAdminOperations).toHaveBeenCalled();
    expect(serviceMocks.fetchUsersListWithOptions).not.toHaveBeenCalled();
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
      cursor: "eyJjcmVhdGVkX2F0IjoiMjAyNi0wNS0xOFQwMDowMDowMC4wMDBaIiwiaWQiOiJpbnZpdGUtNTAifQ",
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
      expect(result.current.auditLogQuery.isSuccess).toBe(true);
      expect(result.current.auditMonthsQuery.isSuccess).toBe(true);
    });
    expect(serviceMocks.fetchAdminAuditLog).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 50,
      search: "raid",
      start_at: localDayStartIso("2026-03-01"),
      end_at: localDayEndIso("2026-03-08"),
      entity_type: undefined,
      entity_id: undefined,
      actor_id: undefined,
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
      canManageSiteConfig: true,
      canManageImportantNotices: false,
      canManageClasses: false,
    });
  });

  it("uses the same normalized audit search in the query key and request", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([{
      id: "auditor",
      permissions: { "admin.audit.view": true },
    }]);
    serviceMocks.fetchAdminAuditLog.mockResolvedValueOnce({ data: [], next_cursor: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () => useAdminData({
        isModerator: true,
        userRole: "auditor",
        activeTab: "audit",
        auditSearch: "  raid  ",
        auditDateFrom: "",
        auditDateTo: "",
        auditEntityType: "event",
        auditEntityId: "event-1",
        auditActorId: "",
        inviteVisibility: "active",
        inviteSearch: "",
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.auditLogQuery.isSuccess).toBe(true));
    expect(serviceMocks.fetchAdminAuditLog).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 50,
      search: "raid",
      start_at: undefined,
      end_at: undefined,
      entity_type: "event",
      entity_id: "event-1",
      actor_id: undefined,
    });
    expect(queryClient.getQueryState(queryKeys.admin.auditLog("raid", "", "", "event", "event-1"))).toBeDefined();
    expect(queryClient.getQueryState(queryKeys.admin.auditLog("  raid  ", "", "", "event", "event-1"))).toBeUndefined();
    expect(serviceMocks.fetchUsersListWithOptions).not.toHaveBeenCalled();
  });

  it("forwards a one-sided audit date so the HTTP contract can reject it", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([{
      id: "auditor",
      permissions: { "admin.audit.view": true },
    }]);
    serviceMocks.fetchAdminAuditLog.mockResolvedValueOnce({ data: [], next_cursor: null });

    const { result } = renderHook(
      () => useAdminData({
        isModerator: true,
        userRole: "auditor",
        activeTab: "audit",
        auditSearch: "",
        auditDateFrom: "2026-03-08",
        auditDateTo: "",
        auditEntityType: "",
        auditEntityId: "",
        auditActorId: "",
        inviteVisibility: "active",
        inviteSearch: "",
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.auditLogQuery.isSuccess).toBe(true));
    expect(serviceMocks.fetchAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      start_at: localDayStartIso("2026-03-08"),
      end_at: undefined,
    }));
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
    serviceMocks.fetchAdminOperations.mockResolvedValueOnce({});

    const { result } = renderHook(
      () =>
        useAdminData({
          isModerator: true,
          userRole: "status-only",
          activeTab: "operations",
          auditSearch: "",
          auditDateFrom: "",
          auditDateTo: "",
          auditEntityType: "",
          auditEntityId: "",
          auditActorId: "",
          inviteVisibility: "active",
          inviteSearch: "",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
      expect(result.current.statusQuery.isSuccess).toBe(true);
      expect(result.current.operationsQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchUsersListWithOptions).not.toHaveBeenCalled();
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
      canManageSiteConfig: false,
      canManageImportantNotices: false,
      canManageClasses: false,
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
          auditSearch: "",
          auditDateFrom: "",
          auditDateTo: "",
          auditEntityType: "",
          auditEntityId: "",
          auditActorId: "",
          inviteVisibility: "active",
          inviteSearch: "",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchUsersListWithOptions).not.toHaveBeenCalled();
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
      canManageSiteConfig: false,
      canManageImportantNotices: false,
      canManageClasses: false,
    });
  });

  it("starts permitted admin section queries without loading inaccessible role configuration", async () => {
    serviceMocks.fetchRoles.mockImplementationOnce(() => new Promise(() => undefined));
    serviceMocks.fetchAdminSiteConfig.mockResolvedValueOnce({ site: {} });

    const { result } = renderHook(
      () =>
        useAdminData({
          isModerator: true,
          userRole: "admin",
          activeTab: "siteConfig",
          auditSearch: "",
          auditDateFrom: "",
          auditDateTo: "",
          auditEntityType: "",
          auditEntityId: "",
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
            canManageClasses: false,
            canManageSiteConfig: true,
            canManageImportantNotices: false,
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.siteConfigQuery.isSuccess).toBe(true);
    });

    expect(result.current.rolesQuery.isLoading).toBe(false);
    expect(serviceMocks.fetchRoles).not.toHaveBeenCalled();
    expect(serviceMocks.fetchUsersListWithOptions).not.toHaveBeenCalled();
    expect(serviceMocks.fetchAdminSiteConfig).toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteLinks).not.toHaveBeenCalled();
  });

  it("loads role metadata for invite management without replacing session authority", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([{
      id: "other-role",
      permissions: { "admin.roles.manage": true },
    }]);
    serviceMocks.fetchAdminInviteLinks.mockResolvedValueOnce({ data: [], next_cursor: null, total: 0 });
    serviceMocks.fetchAdminInviteStats.mockResolvedValueOnce({});
    const effectivePermissions = {
      canAccessAdmin: true,
      canViewUsers: false,
      canViewInvites: true,
      canViewAudit: false,
      canExportAudit: false,
      canViewRoles: false,
      canManageRoles: false,
      canViewStatus: false,
      canManageBadges: false,
      canManageSiteConfig: false,
      canManageImportantNotices: false,
      canManageClasses: false,
    };

    const { result } = renderHook(
      () => useAdminData({
        isModerator: true,
        userRole: "invite-manager",
        activeTab: "invite",
        effectivePermissions,
        canReadRoleMetadata: true,
        auditSearch: "",
        auditDateFrom: "",
        auditDateTo: "",
        auditEntityType: "",
        auditEntityId: "",
        auditActorId: "",
        inviteVisibility: "active",
        inviteSearch: "",
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
      expect(result.current.inviteLinksQuery.isSuccess).toBe(true);
    });
    expect(serviceMocks.fetchRoles).toHaveBeenCalledOnce();
    expect(result.current.permissions).toEqual(effectivePermissions);
  });
});
