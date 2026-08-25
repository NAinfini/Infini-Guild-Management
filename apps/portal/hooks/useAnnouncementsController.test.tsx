import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnouncementsController } from "./useAnnouncementsController";
import { userScopedStorageKey } from "../session-storage";
import { DEFAULT_SITE_MEDIA_POLICY } from "@guild/shared";
import { useSiteConfigStore } from "../stores/site-config";

const serviceMocks = vi.hoisted(() => ({
  archiveAnnouncement: vi.fn(),
  createAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
  fetchAnnouncement: vi.fn(),
  fetchAnnouncements: vi.fn(),
  uploadAnnouncementAttachment: vi.fn(),
  uploadPendingAnnouncementImages: vi.fn(),
  updateAnnouncement: vi.fn(),
  uploadAnnouncementImages: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const routeSearchMock = vi.hoisted(() => ({
  announcementId: undefined as string | undefined,
  selection: undefined as "none" | undefined,
}));
const authState = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));

vi.mock("../stores/auth", () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
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
  uploadAnnouncementAttachment: serviceMocks.uploadAnnouncementAttachment,
  uploadPendingAnnouncementImages: serviceMocks.uploadPendingAnnouncementImages,
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
  const pendingUploadResponse = {
    expires_at: "2026-07-29T00:00:00.000Z",
    media_ids: ["media1234567890abcdef"],
  };
  const attachmentUploadResponse = {
    expires_at: "2026-07-29T00:00:00.000Z",
    attachment: {
      media_id: "attachment1234567890ab",
      name: "guild-guide.pdf",
      content_type: "application/pdf",
      byte_size: 2_400_000,
    },
  };

  beforeEach(() => {
    localStorage.clear();
    useSiteConfigStore.setState({ mediaPolicy: DEFAULT_SITE_MEDIA_POLICY });
    authState.user = { id: "user-1" };
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
    serviceMocks.uploadPendingAnnouncementImages.mockResolvedValue(pendingUploadResponse);
    serviceMocks.uploadAnnouncementAttachment.mockResolvedValue(attachmentUploadResponse);
    serviceMocks.uploadAnnouncementImages.mockResolvedValue({
      media_ids: ["image1234567890abcdef"],
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

  it("sends only one create request when publish is triggered twice", async () => {
    let resolveCreate!: (value: { id: string }) => void;
    serviceMocks.createAnnouncement.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    act(() => {
      result.current.handleCreateByStatus();
    });
    await waitFor(() => expect(result.current.isCreating).toBe(true));
    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}');
    });
    await waitFor(() => expect(result.current.isPublishReady).toBe(true));

    act(() => {
      result.current.handleFinish("none");
      result.current.handleFinish("none");
    });

    await waitFor(() => expect(serviceMocks.createAnnouncement).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.savePending).toBe(true));

    resolveCreate({ id: "announcement-1" });
    await waitFor(() => expect(result.current.savePending).toBe(false));
  });

  it("reloads announcement last-seen state from the active user's scoped storage", async () => {
    const firstSeenAt = "2026-01-01T00:00:00.000Z";
    const secondSeenAt = "2026-02-01T00:00:00.000Z";
    localStorage.setItem(
      userScopedStorageKey("portal:last_seen", "user-1"),
      JSON.stringify({ announcements: { lastSeenAt: firstSeenAt } }),
    );
    localStorage.setItem(
      userScopedStorageKey("portal:last_seen", "user-2"),
      JSON.stringify({ announcements: { lastSeenAt: secondSeenAt } }),
    );
    localStorage.setItem(
      "portal:last_seen",
      JSON.stringify({ announcements: { lastSeenAt: "2099-01-01T00:00:00.000Z" } }),
    );
    const { result, rerender } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.announcementsLastSeenAt).toBe(firstSeenAt));
    authState.user = { id: "user-2" };
    rerender();

    await waitFor(() => expect(result.current.announcementsLastSeenAt).toBe(secondSeenAt));
  });

  it("exits create mode when browser history restores a selected announcement", async () => {
    const selected = {
      id: "announcement-history",
      title: "History selection",
      body_json: "{}",
      pinned: false,
      status: "published" as const,
      publish_at: null,
      expires_at: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
      attachments: [],
    };
    serviceMocks.fetchAnnouncement.mockResolvedValue(selected);
    const { result, rerender } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    act(() => {
      result.current.handleCreateByStatus();
    });
    await waitFor(() => expect(result.current.isCreating).toBe(true));

    routeSearchMock.selection = undefined;
    routeSearchMock.announcementId = selected.id;
    rerender();

    await waitFor(() => expect(result.current.isCreating).toBe(false));
    expect(result.current.selectedId).toBe(selected.id);
  });

  it("sends null when clearing a scheduled publication time while saving a draft", async () => {
    const selected = {
      id: "announcement-scheduled",
      title: "Scheduled announcement",
      body_json: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}',
      pinned: false,
      status: "scheduled" as const,
      publish_at: "2026-08-10T00:00:00.000Z",
      expires_at: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
      attachments: [],
    };
    routeSearchMock.announcementId = selected.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(selected);
    serviceMocks.updateAnnouncement.mockResolvedValue(selected);

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selected).toEqual(selected));
    await waitFor(() => expect(result.current.isPublishReady).toBe(true));
    await waitFor(() => expect(result.current.publishAt).not.toBe(""));
    act(() => {
      result.current.setPublishAt("");
    });
    act(() => {
      result.current.handleFinish("draft");
    });

    await waitFor(() => expect(serviceMocks.updateAnnouncement).toHaveBeenCalledWith(
      selected.id,
      expect.objectContaining({ status: "draft", publish_at: null }),
      `"announcement-${selected.id}-${selected.updated_at}"`,
    ));
  });

  it("uploads create-mode images as pending media without creating a ghost announcement", async () => {
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
    expect(serviceMocks.uploadPendingAnnouncementImages).toHaveBeenCalledWith([file]);
    expect(imageUrl).toContain(`/api/media/${pendingUploadResponse.media_ids[0]}/view`);

    await act(async () => {
      await result.current.handleUploadAnnouncementImages(file);
    });
    expect(serviceMocks.uploadPendingAnnouncementImages).toHaveBeenLastCalledWith([file]);
  });

  it("saves announcement content without exposing pending media IDs", async () => {
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
    const payload = serviceMocks.createAnnouncement.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({ title: "Maintenance", status: "draft" }));
    expect(payload).not.toHaveProperty("media_ids");
  });

  it("keeps staged attachments in the draft and binds their ordered media IDs on create", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["%PDF-1.7"], "guild-guide.pdf", { type: "application/pdf" });

    act(() => {
      result.current.handleCreateByStatus();
    });
    await act(async () => {
      await result.current.handleUploadAnnouncementAttachment(file);
    });

    expect(serviceMocks.uploadAnnouncementAttachment).toHaveBeenCalledWith(file);
    expect(result.current.attachments).toEqual([attachmentUploadResponse.attachment]);

    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}');
    });
    await waitFor(() => expect(result.current.isPublishReady).toBe(true));
    act(() => {
      result.current.handleFinish("draft");
    });

    await waitFor(() => expect(serviceMocks.createAnnouncement).toHaveBeenCalled());
    expect(serviceMocks.createAnnouncement.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      attachment_media_ids: [attachmentUploadResponse.attachment.media_id],
    }));
  });

  it("rejects an attachment above the current Site Config limit before uploading", async () => {
    useSiteConfigStore.setState({
      mediaPolicy: {
        ...DEFAULT_SITE_MEDIA_POLICY,
        max_file_size_bytes: {
          ...DEFAULT_SITE_MEDIA_POLICY.max_file_size_bytes,
          announcement_attachment: 5,
        },
      },
    });
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.handleUploadAnnouncementAttachment(
        new File(["%PDF-1.7"], "guild-guide.pdf", { type: "application/pdf" }),
      );
    });

    expect(serviceMocks.uploadAnnouncementAttachment).not.toHaveBeenCalled();
  });

  it("abandons pending images without creating or archiving a record", async () => {
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
        author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
        attachments: [],
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
        author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
        attachments: [],
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

    await waitFor(() => expect(result.current.selectedId).toBe("announcement-1"));

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
      author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
      attachments: [],
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
      author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
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
      expect(result.current.rows.map((item) => item.id)).toEqual([
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

  it("passes server sort state through and resets it to updated_desc", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "updated_desc" }),
      ),
    );
    expect(result.current.sortOrder).toBe("updated_desc");

    act(() => {
      result.current.setSortOrder("updated_asc");
    });
    await waitFor(() =>
      expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "updated_asc" }),
      ),
    );
    expect(result.current.sortOrder).toBe("updated_asc");

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.sortOrder).toBe("updated_desc");
  });

  it("does not exclude archived announcements from All", async () => {
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, archived: undefined }),
    ));

    act(() => result.current.setStatusFilter("draft"));
    await waitFor(() => expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", archived: false }),
    ));

    act(() => result.current.setStatusFilter("archived"));
    await waitFor(() => expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", archived: true }),
    ));
  });
});
