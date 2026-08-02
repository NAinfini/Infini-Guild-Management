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
  stageAnnouncementImages: vi.fn(),
  updateAnnouncement: vi.fn(),
  uploadAnnouncementImages: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const routeSearchMock = vi.hoisted(() => ({
  announcementId: undefined as string | undefined,
  selection: undefined as "none" | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => routeSearchMock,
}));

vi.mock("../services/AnnouncementService", () => ({
  archiveAnnouncement: serviceMocks.archiveAnnouncement,
  createAnnouncement: serviceMocks.createAnnouncement,
  deleteAnnouncement: serviceMocks.deleteAnnouncement,
  fetchAnnouncement: serviceMocks.fetchAnnouncement,
  fetchAnnouncements: serviceMocks.fetchAnnouncements,
  stageAnnouncementImages: serviceMocks.stageAnnouncementImages,
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
  const stagingResponse = {
    staging_id: "nanoid1234567890abcde",
    staging_token: "signed-announcement-staging-token".repeat(3),
    expires_at: "2026-07-29T00:00:00.000Z",
    keys: ["announcement/nanoid1234567890abcde/images/image-1"],
  };

  beforeEach(() => {
    navigateMock.mockReset();
    routeSearchMock.announcementId = undefined;
    routeSearchMock.selection = undefined;
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }
    serviceMocks.fetchAnnouncements.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 0,
    });
    serviceMocks.fetchAnnouncement.mockResolvedValue(null);
    serviceMocks.createAnnouncement.mockResolvedValue({ id: "announcement-1" });
    serviceMocks.stageAnnouncementImages.mockResolvedValue(stagingResponse);
    serviceMocks.uploadAnnouncementImages.mockResolvedValue({
      keys: ["announcement/announcement-1/images/image-1"],
    });
  });

  it("does not include unsupported expires_at in create payloads", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    act(() => {
      result.current.handleCreateByStatus();
    });
    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}');
    });
    await waitFor(() => expect(result.current.isPublishReady).toBe(true));
    act(() => {
      result.current.handleFinish("none");
    });

    await waitFor(() => expect(serviceMocks.createAnnouncement).toHaveBeenCalled());
    expect(serviceMocks.createAnnouncement.mock.calls[0]?.[0]).not.toHaveProperty("expires_at");
  });

  it("stages create-mode images without creating a ghost announcement", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["image"], "image.webp", { type: "image/webp" });

    act(() => {
      result.current.handleCreateByStatus();
    });

    let imageUrl = "";
    await act(async () => {
      imageUrl = await result.current.handleUploadAnnouncementImages(file);
    });

    expect(serviceMocks.createAnnouncement).not.toHaveBeenCalled();
    expect(serviceMocks.stageAnnouncementImages).toHaveBeenCalledWith(null, [file]);
    expect(imageUrl).toContain(encodeURIComponent(stagingResponse.keys[0]!));

    await act(async () => {
      await result.current.handleUploadAnnouncementImages(file);
    });
    expect(serviceMocks.stageAnnouncementImages).toHaveBeenLastCalledWith(
      stagingResponse.staging_token,
      [file],
    );
  });

  it("claims the staging token only on explicit save", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["image"], "image.webp", { type: "image/webp" });

    act(() => {
      result.current.handleCreateByStatus();
    });
    await act(async () => {
      await result.current.handleUploadAnnouncementImages(file);
    });
    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}');
    });
    act(() => {
      result.current.handleFinish("draft");
    });

    await waitFor(() => expect(serviceMocks.createAnnouncement).toHaveBeenCalled());
    expect(serviceMocks.createAnnouncement.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        staging_token: stagingResponse.staging_token,
      }),
    );
  });

  it("abandons staged images without creating or archiving a record", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["image"], "image.webp", { type: "image/webp" });

    act(() => {
      result.current.handleCreateByStatus();
    });
    await act(async () => {
      await result.current.handleUploadAnnouncementImages(file);
    });
    act(() => {
      result.current.handleCloseEditor();
    });

    expect(serviceMocks.createAnnouncement).not.toHaveBeenCalled();
    expect(serviceMocks.updateAnnouncement).not.toHaveBeenCalled();
    expect(serviceMocks.archiveAnnouncement).not.toHaveBeenCalled();
  });

  it("does not publish a new announcement until required content is present", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    act(() => {
      result.current.handleCreateByStatus();
    });
    await waitFor(() => expect(result.current.isCreating).toBe(true));

    expect(result.current.isPublishReady).toBe(false);
    act(() => {
      result.current.handleFinish("none");
    });
    expect(serviceMocks.createAnnouncement).not.toHaveBeenCalled();

    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}');
    });
    await waitFor(() => expect(result.current.isPublishReady).toBe(true));
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
    serviceMocks.fetchAnnouncements.mockResolvedValue({
      data: announcements,
      total: announcements.length,
      page: 1,
      limit: 50,
      total_pages: 1,
    });
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
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/announcements",
        replace: true,
      }),
    );
    const deleteNavigation = navigateMock.mock.calls.at(-1)?.[0];
    expect(deleteNavigation.search({
      announcementId: "announcement-1",
      view: "external",
    })).toEqual({
      announcementId: undefined,
      selection: "none",
      view: "external",
    });
  });

  it("restores a deep-linked announcement selection", async () => {
    routeSearchMock.announcementId = "announcement-deep-link";
    serviceMocks.fetchAnnouncements.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 0,
    });
    serviceMocks.fetchAnnouncement.mockResolvedValue({
      id: "announcement-deep-link",
      title: "Deep link",
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
    });

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    expect(result.current.selectedId).toBe("announcement-deep-link");
    await waitFor(() =>
      expect(serviceMocks.fetchAnnouncement).toHaveBeenCalledWith("announcement-deep-link"),
    );
  });

  it("loads additional pages without mixing results after a filter change", async () => {
    const announcement = (id: string, pinned: boolean) => ({
      id,
      title: id,
      body_json: "{}",
      pinned,
      status: "published" as const,
      publish_at: null,
      expires_at: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: `2026-01-0${id.endsWith("2") ? "2" : "1"}T00:00:00.000Z`,
    });
    const first = announcement("announcement-1", false);
    const second = announcement("announcement-2", false);
    const pinned = announcement("announcement-pinned", true);

    serviceMocks.fetchAnnouncements.mockImplementation(
      async ({ page, pinned: pinnedFilter }: { page: number; pinned?: boolean }) => {
        if (pinnedFilter) {
          return {
            data: [pinned],
            total: 1,
            page: 1,
            limit: 50,
            total_pages: 1,
          };
        }
        return {
          data: page === 1 ? [first] : [second],
          total: 2,
          page,
          limit: 1,
          total_pages: 2,
        };
      },
    );

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.rows.map((item) => item.id)).toEqual(["announcement-1"]));
    expect(result.current.listHasMore).toBe(true);

    await act(async () => {
      await result.current.onLoadMoreList();
    });
    await waitFor(() =>
      expect(result.current.rows.map((item) => item.id).sort()).toEqual([
        "announcement-1",
        "announcement-2",
      ]),
    );

    act(() => {
      result.current.setPinnedFilter(true);
    });

    await waitFor(() =>
      expect(result.current.rows.map((item) => item.id)).toEqual(["announcement-pinned"]),
    );
    expect(result.current.listHasMore).toBe(false);
  });
});
