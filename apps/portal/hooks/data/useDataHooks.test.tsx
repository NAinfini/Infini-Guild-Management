// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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
  fetchEventDetail: vi.fn(),
  fetchEventsList: vi.fn(),
  fetchGuildWarActive: vi.fn(),
  fetchGuildWarHistory: vi.fn(),
  fetchGuildWarHistoryDetail: vi.fn(),
  fetchRoles: vi.fn(),
  fetchTemplatesList: vi.fn(),
  fetchUserDetail: vi.fn(),
  fetchUsersList: vi.fn(),
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
  fetchUserDetail: serviceMocks.fetchUserDetail,
  fetchUsersList: serviceMocks.fetchUsersList,
}));

vi.mock("../../services/AdminService", () => ({
  fetchAdminAuditArchiveMonths: serviceMocks.fetchAdminAuditArchiveMonths,
  fetchAdminAuditLog: serviceMocks.fetchAdminAuditLog,
  fetchAdminInviteLinks: serviceMocks.fetchAdminInviteLinks,
  fetchAdminInviteStats: serviceMocks.fetchAdminInviteStats,
  fetchAdminStatus: serviceMocks.fetchAdminStatus,
  fetchRoles: serviceMocks.fetchRoles,
}));

vi.mock("../../utils/permissions", () => ({
  canExportAudit: () => true,
  canViewStatus: () => true,
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
    serviceMocks.fetchUsersList.mockResolvedValueOnce({ data: [] });

    const { result } = renderHook(
      () => useEventsData({ eventType: "social", archivedOnly: false }),
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
    });
    expect(serviceMocks.fetchUsersList).toHaveBeenCalled();
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
      archived: false,
    });
    expect(serviceMocks.fetchEventDetail).toHaveBeenCalledWith("event-1");
    expect(serviceMocks.fetchGuildWarActive).toHaveBeenCalledWith("event-1");
    expect(serviceMocks.fetchGuildWarHistory).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      date_from: "2026-03-01T00:00:00.000Z",
      date_to: "2026-03-08T23:59:59.999Z",
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

  it("loads admin data through service exports when permissions allow it", async () => {
    serviceMocks.fetchRoles.mockResolvedValueOnce([]);
    serviceMocks.fetchUsersList.mockResolvedValueOnce({ data: [] });
    serviceMocks.fetchAdminInviteLinks.mockResolvedValueOnce([]);
    serviceMocks.fetchAdminInviteStats.mockResolvedValueOnce({});
    serviceMocks.fetchAdminAuditLog.mockResolvedValueOnce({ data: [] });
    serviceMocks.fetchAdminAuditArchiveMonths.mockResolvedValueOnce([]);
    serviceMocks.fetchAdminStatus.mockResolvedValueOnce({});

    const { result } = renderHook(
      () =>
        useAdminData({
          isModerator: true,
          userRole: "admin",
          auditPage: 2,
          auditSearch: "raid",
          auditDateFrom: "2026-03-01",
          auditDateTo: "2026-03-08",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.rolesQuery.isSuccess).toBe(true);
      expect(result.current.usersQuery.isSuccess).toBe(true);
      expect(result.current.inviteLinksQuery.isSuccess).toBe(true);
      expect(result.current.inviteStatsQuery.isSuccess).toBe(true);
      expect(result.current.auditLogQuery.isSuccess).toBe(true);
      expect(result.current.auditMonthsQuery.isSuccess).toBe(true);
      expect(result.current.statusQuery.isSuccess).toBe(true);
    });

    expect(serviceMocks.fetchRoles).toHaveBeenCalled();
    expect(serviceMocks.fetchUsersList).toHaveBeenCalled();
    expect(serviceMocks.fetchAdminInviteLinks).toHaveBeenCalledWith({
      include_expired: true,
      include_revoked: true,
    });
    expect(serviceMocks.fetchAdminAuditLog).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      search: "raid",
      start_at: "2026-03-01T00:00:00.000Z",
      end_at: "2026-03-08T23:59:59.999Z",
    });
    expect(serviceMocks.fetchAdminStatus).toHaveBeenCalled();
  });
});
