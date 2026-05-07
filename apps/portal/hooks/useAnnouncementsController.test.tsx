// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnouncementsController } from "./useAnnouncementsController";

const serviceMocks = vi.hoisted(() => ({
  archiveAnnouncement: vi.fn(),
  createAnnouncement: vi.fn(),
  fetchAnnouncement: vi.fn(),
  fetchAnnouncements: vi.fn(),
  updateAnnouncement: vi.fn(),
  uploadAnnouncementImages: vi.fn(),
}));

vi.mock("../services/AnnouncementService", () => ({
  archiveAnnouncement: serviceMocks.archiveAnnouncement,
  createAnnouncement: serviceMocks.createAnnouncement,
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
});
