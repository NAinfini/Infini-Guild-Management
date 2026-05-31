// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnouncementsController } from "./useAnnouncementsController";

const serviceMocks = vi.hoisted(() => ({
  archiveAnnouncement: vi.fn(),
  createAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
  fetchAnnouncement: vi.fn(),
  fetchAnnouncements: vi.fn(),
  updateAnnouncement: vi.fn(),
  uploadAnnouncementImages: vi.fn(),
}));

vi.mock("../services/AnnouncementService", () => ({
  archiveAnnouncement: serviceMocks.archiveAnnouncement,
  createAnnouncement: serviceMocks.createAnnouncement,
  deleteAnnouncement: serviceMocks.deleteAnnouncement,
  fetchAnnouncement: serviceMocks.fetchAnnouncement,
  fetchAnnouncements: serviceMocks.fetchAnnouncements,
  updateAnnouncement: serviceMocks.updateAnnouncement,
  uploadAnnouncementImages: serviceMocks.uploadAnnouncementImages,
}));

vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({
    canManage: () => true,
  }),
}));

vi.mock("./useExternalView", () => ({
  useExternalView: () => false,
}));

vi.mock("./useAppError", () => ({
  useAppError: () => ({
    showError: vi.fn(),
  }),
}));

vi.mock("./useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAnnouncementsController", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }
    serviceMocks.fetchAnnouncements.mockResolvedValue({ data: [], total: 0 });
    serviceMocks.createAnnouncement.mockResolvedValue({ id: "announcement-1" });
  });

  it("does not include unsupported expires_at in create payloads", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    act(() => {
      result.current.handleCreateByStatus();
    });
    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph"}]}');
      result.current.handleFinish("none");
    });

    await waitFor(() => expect(serviceMocks.createAnnouncement).toHaveBeenCalled());
    expect(serviceMocks.createAnnouncement.mock.calls[0]?.[0]).not.toHaveProperty("expires_at");
  });

  it("keeps the announcement detail empty after deleting the selected announcement", async () => {
    const announcements = [
      {
        id: "announcement-1",
        title: "First",
        body_json: "{}",
        pinned: false,
        status: "published",
        publish_at: null,
        expires_at: null,
        archived_at: null,
        created_by: "user-1",
        updated_by: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "announcement-2",
        title: "Second",
        body_json: "{}",
        pinned: false,
        status: "published",
        publish_at: null,
        expires_at: null,
        archived_at: null,
        created_by: "user-1",
        updated_by: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    serviceMocks.fetchAnnouncements.mockResolvedValue({ data: announcements, total: announcements.length });
    serviceMocks.fetchAnnouncement.mockResolvedValue(announcements[0]);
    serviceMocks.deleteAnnouncement.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedId).toBe("announcement-2"));

    act(() => {
      result.current.setSelectedId("announcement-1");
    });
    await waitFor(() => expect(result.current.selectedId).toBe("announcement-1"));

    act(() => {
      result.current.handleDelete();
    });

    await waitFor(() => expect(serviceMocks.deleteAnnouncement).toHaveBeenCalled());
    expect(serviceMocks.deleteAnnouncement.mock.calls[0]?.[0]).toBe("announcement-1");
    await waitFor(() => expect(result.current.selectedId).toBeNull());
  });
});
