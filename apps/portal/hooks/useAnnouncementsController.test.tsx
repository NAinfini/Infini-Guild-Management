import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnouncementsController } from "./useAnnouncementsController";
import { DEFAULT_SITE_MEDIA_POLICY, type Announcement } from "@guild/shared";
import { useSiteConfigStore } from "../stores/site-config";
import { queryKeys } from "../api/query-keys";

const serviceMocks = vi.hoisted(() => ({
  archiveAnnouncement: vi.fn(),
  createAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
  fetchAnnouncement: vi.fn(),
  fetchAnnouncements: vi.fn(),
  recordAnnouncementView: vi.fn(),
  uploadAnnouncementAttachment: vi.fn(),
  uploadPendingAnnouncementImages: vi.fn(),
  updateAnnouncement: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const routeMock = vi.hoisted(() => ({
  announcementId: undefined as string | undefined,
  pathname: "/announcements",
  entryKey: "announcements-list-entry",
}));
const accessState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  external: false,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ announcementId: routeMock.announcementId }),
  useLocation: <T,>({ select }: { select: (location: {
    pathname: string;
    href: string;
    state: { __TSR_key: string; __TSR_index: number };
  }) => T }) =>
    select({
      pathname: routeMock.pathname,
      href: routeMock.pathname,
      state: { __TSR_key: routeMock.entryKey, __TSR_index: 0 },
    }),
}));

vi.mock("../services/AnnouncementService", () => ({
  archiveAnnouncement: serviceMocks.archiveAnnouncement,
  createAnnouncement: serviceMocks.createAnnouncement,
  deleteAnnouncement: serviceMocks.deleteAnnouncement,
  fetchAnnouncement: serviceMocks.fetchAnnouncement,
  fetchAnnouncements: serviceMocks.fetchAnnouncements,
  recordAnnouncementView: serviceMocks.recordAnnouncementView,
  uploadAnnouncementAttachment: serviceMocks.uploadAnnouncementAttachment,
  uploadPendingAnnouncementImages: serviceMocks.uploadPendingAnnouncementImages,
  updateAnnouncement: serviceMocks.updateAnnouncement,
}));

vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({
    canManage: (permissions: string[]) => permissions.some((permission) => (
      accessState.permissions.has(permission)
    )),
  }),
}));

vi.mock("./useExternalView", () => ({
  useExternalView: () => accessState.external,
}));

vi.mock("./useAppError", () => ({
  useAppError: () => ({
    showError: vi.fn(),
  }),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("./useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient = createQueryClient()): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function announcementDetail(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: "announcement-edit",
    title: "Original announcement",
    body_json: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original body"}]}]}',
    category: "announcement",
    excerpt: "Original body",
    pinned: false,
    view_count: 0,
    preview_media_id: null,
    status: "published",
    publish_at: "2026-08-01T00:00:00.000Z",
    expires_at: null,
    archived_at: null,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
    attachments: [],
    ...overrides,
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
    accessState.permissions = new Set([
      "announcements.create",
      "announcements.edit",
      "announcements.archive",
      "announcements.delete",
    ]);
    accessState.external = false;
    navigateMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    routeMock.announcementId = undefined;
    routeMock.pathname = "/announcements";
    routeMock.entryKey = "announcements-list-entry";
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
    serviceMocks.recordAnnouncementView.mockResolvedValue({ view_count: 1 });
    serviceMocks.createAnnouncement.mockResolvedValue({ id: "announcement-1" });
    serviceMocks.uploadPendingAnnouncementImages.mockResolvedValue(pendingUploadResponse);
    serviceMocks.uploadAnnouncementAttachment.mockResolvedValue(attachmentUploadResponse);
  });

  it("requests and exposes at most three pinned announcements", async () => {
    const pinnedAnnouncements = Array.from({ length: 4 }, (_, index) => announcementDetail({
      id: `pinned-${index + 1}`,
      title: `Pinned ${index + 1}`,
      pinned: true,
    }));
    serviceMocks.fetchAnnouncements.mockImplementation(async ({ pinned, page, limit }) => ({
      data: pinned ? pinnedAnnouncements : [],
      total: pinned ? pinnedAnnouncements.length : 0,
      page,
      limit,
      total_pages: pinned ? 2 : 0,
    }));

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.pinnedRows).toHaveLength(3));
    expect(result.current.pinnedRows.map(({ id }) => id)).toEqual(["pinned-1", "pinned-2", "pinned-3"]);
    expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      limit: 3,
      pinned: true,
    }));
  });

  it("does not load the hidden catalog or pinned rows on a detail route", async () => {
    routeMock.pathname = "/announcements/announcement-detail";
    routeMock.announcementId = "announcement-detail";
    serviceMocks.fetchAnnouncement.mockResolvedValue(announcementDetail({ id: "announcement-detail" }));

    renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(serviceMocks.fetchAnnouncement).toHaveBeenCalledOnce());
    expect(serviceMocks.fetchAnnouncements).not.toHaveBeenCalled();
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

    routeMock.pathname = `/announcements/${selected.id}`;
    routeMock.announcementId = selected.id;
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
    routeMock.pathname = `/announcements/${selected.id}`;
    routeMock.announcementId = selected.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(selected);
    serviceMocks.updateAnnouncement.mockResolvedValue(selected);

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selected).toEqual(expect.objectContaining(selected)));
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

  it("does not enter direct create mode with edit permission alone", async () => {
    accessState.permissions = new Set(["announcements.edit"]);
    routeMock.pathname = "/announcements/new";
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.canCreate).toBe(false));
    expect(result.current.isCreating).toBe(false);
    expect(await result.current.handleFinish("draft")).toBe(false);
    expect(serviceMocks.createAnnouncement).not.toHaveBeenCalled();
  });

  it("does not enter direct create mode from external preview", async () => {
    accessState.external = true;
    routeMock.pathname = "/announcements/new";
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.canCreate).toBe(false));
    expect(result.current.isCreating).toBe(false);
    expect(serviceMocks.uploadAnnouncementAttachment).not.toHaveBeenCalled();
  });

  it("stages editor images for an existing announcement without mutating its aggregate", async () => {
    const selected = announcementDetail();
    routeMock.pathname = `/announcements/${selected.id}`;
    routeMock.announcementId = selected.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(selected);
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["image"], "image.webp", { type: "image/webp" });

    await waitFor(() => expect(result.current.selected?.id).toBe(selected.id));
    act(() => result.current.handleStartEditing());
    await act(async () => {
      await result.current.handleUploadAnnouncementImages(file);
    });

    expect(serviceMocks.uploadPendingAnnouncementImages).toHaveBeenCalledWith([file]);
    expect(serviceMocks.updateAnnouncement).not.toHaveBeenCalled();
  });

  it("freezes the editor snapshot across a background refresh and saves with its original ETag", async () => {
    const original = announcementDetail();
    const remote = announcementDetail({
      title: "Remote announcement",
      updated_at: "2026-08-02T00:00:00.000Z",
    });
    const saved = announcementDetail({
      title: "Local announcement",
      status: "draft",
      updated_at: "2026-08-03T00:00:00.000Z",
    });
    routeMock.pathname = `/announcements/${original.id}`;
    routeMock.announcementId = original.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(original);
    serviceMocks.updateAnnouncement.mockResolvedValue(saved);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useAnnouncementsController(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.title).toBe(original.title));
    act(() => {
      result.current.handleStartEditing();
      result.current.setTitle("Local announcement");
    });
    act(() => {
      queryClient.setQueryData(queryKeys.announcements.detail(original.id), remote);
    });

    await waitFor(() => expect(result.current.selected?.title).toBe(remote.title));
    expect(result.current.title).toBe("Local announcement");

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.handleFinish("draft");
    });

    expect(succeeded).toBe(true);
    expect(serviceMocks.updateAnnouncement).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ title: "Local announcement", status: "draft" }),
      `"announcement-${original.id}-${original.updated_at}"`,
    );
  });

  it("keeps a failed edit retryable with the same frozen ETag", async () => {
    const original = announcementDetail();
    routeMock.pathname = `/announcements/${original.id}`;
    routeMock.announcementId = original.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(original);
    serviceMocks.updateAnnouncement.mockRejectedValueOnce(new Error("conflict"));
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.title).toBe(original.title));
    act(() => {
      result.current.handleStartEditing();
      result.current.setTitle("Retryable local edit");
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.handleFinish("draft");
    });

    expect(succeeded).toBe(false);
    expect(result.current.title).toBe("Retryable local edit");
    expect(serviceMocks.updateAnnouncement).toHaveBeenCalledWith(
      original.id,
      expect.any(Object),
      `"announcement-${original.id}-${original.updated_at}"`,
    );
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
    expect(payload).toEqual(expect.objectContaining({
      title: "Maintenance",
      category: "announcement",
      status: "draft",
    }));
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

  it("waits for a create-mode attachment upload before allowing save", async () => {
    let resolveUpload!: (value: typeof attachmentUploadResponse) => void;
    serviceMocks.uploadAnnouncementAttachment.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["%PDF-1.7"], "guild-guide.pdf", { type: "application/pdf" });

    act(() => result.current.handleCreateByStatus());
    await waitFor(() => expect(result.current.isCreating).toBe(true));
    act(() => {
      result.current.setTitle("Maintenance");
      result.current.setBodyJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Planned work"}]}]}');
    });
    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleUploadAnnouncementAttachment(file);
    });
    await waitFor(() => expect(result.current.attachmentUploading).toBe(true));

    let saved = true;
    await act(async () => {
      saved = await result.current.handleFinish("draft");
    });
    expect(saved).toBe(false);
    expect(serviceMocks.createAnnouncement).not.toHaveBeenCalled();

    resolveUpload(attachmentUploadResponse);
    await act(async () => uploadPromise);
    await act(async () => {
      saved = await result.current.handleFinish("draft");
    });
    expect(saved).toBe(true);
    expect(serviceMocks.createAnnouncement.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      attachment_media_ids: [attachmentUploadResponse.attachment.media_id],
    }));
  });

  it("waits for an edit-mode attachment upload before allowing save", async () => {
    let resolveUpload!: (value: typeof attachmentUploadResponse) => void;
    serviceMocks.uploadAnnouncementAttachment.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    const selected = announcementDetail();
    routeMock.pathname = `/announcements/${selected.id}`;
    routeMock.announcementId = selected.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(selected);
    serviceMocks.updateAnnouncement.mockResolvedValue({
      ...selected,
      attachments: [attachmentUploadResponse.attachment],
    });
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    const file = new File(["%PDF-1.7"], "guild-guide.pdf", { type: "application/pdf" });

    await waitFor(() => expect(result.current.selected?.id).toBe(selected.id));
    act(() => result.current.handleStartEditing());
    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleUploadAnnouncementAttachment(file);
    });
    await waitFor(() => expect(result.current.attachmentUploading).toBe(true));

    expect(await result.current.handleFinish("draft")).toBe(false);
    expect(serviceMocks.updateAnnouncement).not.toHaveBeenCalled();

    resolveUpload(attachmentUploadResponse);
    await act(async () => uploadPromise);
    await act(async () => {
      expect(await result.current.handleFinish("draft")).toBe(true);
    });
    expect(serviceMocks.updateAnnouncement).toHaveBeenCalledWith(
      selected.id,
      expect.objectContaining({
        attachment_media_ids: [attachmentUploadResponse.attachment.media_id],
      }),
      expect.any(String),
    );
  });

  it("ignores an attachment upload that finishes after the editor is discarded", async () => {
    let resolveUpload!: (value: typeof attachmentUploadResponse) => void;
    serviceMocks.uploadAnnouncementAttachment.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    act(() => result.current.handleCreateByStatus());
    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleUploadAnnouncementAttachment(
        new File(["%PDF-1.7"], "guild-guide.pdf", { type: "application/pdf" }),
      );
    });
    await waitFor(() => expect(result.current.attachmentUploading).toBe(true));
    act(() => result.current.handleCloseEditor());

    resolveUpload(attachmentUploadResponse);
    await act(async () => uploadPromise);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.attachments).toEqual([]);
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

  it("clears a discarded edit before navigating so the route blocker cannot ask twice", async () => {
    const selected = announcementDetail();
    routeMock.pathname = `/announcements/${selected.id}`;
    routeMock.announcementId = selected.id;
    serviceMocks.fetchAnnouncement.mockResolvedValue(selected);

    const { result } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.selected?.id).toBe(selected.id));

    act(() => {
      result.current.handleStartEditing();
      result.current.setTitle("Unsaved title");
    });
    await waitFor(() => expect(result.current.isDirty).toBe(true));

    await act(async () => {
      expect(await result.current.setSelectedId(null)).toBe(true);
    });

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.title).toBe(selected.title);
    expect(navigateMock).toHaveBeenLastCalledWith(expect.objectContaining({
      to: "/announcements",
    }));
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
    routeMock.pathname = "/announcements/announcement-1";
    routeMock.announcementId = "announcement-1";
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
    expect(serviceMocks.deleteAnnouncement.mock.calls[0]?.[1]).toBe(
      '"announcement-announcement-1-2026-01-01T00:00:00.000Z"',
    );
    await waitFor(() => expect(result.current.selectedId).toBeNull());
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/announcements",
        replace: true,
        viewTransition: false,
      }),
    );
  });

  it("restores a deep-linked announcement selection", async () => {
    routeMock.pathname = "/announcements/announcement-deep-link";
    routeMock.announcementId = "announcement-deep-link";
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

  it("records one read when an independent detail route is entered", async () => {
    routeMock.pathname = "/announcements/announcement-read";
    routeMock.announcementId = "announcement-read";

    const { rerender } = renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(serviceMocks.recordAnnouncementView.mock.calls[0]?.[0]).toBe("announcement-read"),
    );
    rerender();
    expect(serviceMocks.recordAnnouncementView).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed announcement view request", async () => {
    routeMock.pathname = "/announcements/announcement-read";
    routeMock.announcementId = "announcement-read";
    routeMock.entryKey = "announcement-read-entry";
    serviceMocks.recordAnnouncementView.mockRejectedValue(new Error("network interrupted"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

      await waitFor(() => expect(serviceMocks.recordAnnouncementView).toHaveBeenCalledTimes(1));
      await new Promise<void>((resolve) => setTimeout(resolve, 1_300));

      expect(serviceMocks.recordAnnouncementView).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not count a cached detail until its route has been entered", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.announcements.detail("announcement-cached"), {
      id: "announcement-cached",
      title: "Cached announcement",
      body_json: "{}",
      category: "announcement",
      excerpt: "",
      pinned: false,
      view_count: 3,
      preview_media_id: null,
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
    const { result } = renderHook(() => useAnnouncementsController(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.setSelectedId("announcement-cached");
    });

    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "/announcements/$announcementId",
      params: { announcementId: "announcement-cached" },
    }));
    expect(serviceMocks.recordAnnouncementView).not.toHaveBeenCalled();
  });

  it("counts each cached detail route entry exactly once", async () => {
    const queryClient = createQueryClient();
    const detail = {
      id: "announcement-cached",
      title: "Cached announcement",
      body_json: "{}",
      category: "announcement" as const,
      excerpt: "",
      pinned: false,
      view_count: 3,
      preview_media_id: null,
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
    queryClient.setQueryData(queryKeys.announcements.detail(detail.id), detail);
    const { result, rerender } = renderHook(() => useAnnouncementsController(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.setSelectedId(detail.id);
    });
    expect(serviceMocks.recordAnnouncementView).not.toHaveBeenCalled();

    routeMock.pathname = `/announcements/${detail.id}`;
    routeMock.announcementId = detail.id;
    routeMock.entryKey = "announcement-detail-entry-1";
    rerender();

    await waitFor(() => expect(serviceMocks.recordAnnouncementView).toHaveBeenCalledTimes(1));
    expect(serviceMocks.recordAnnouncementView.mock.calls[0]?.[0]).toBe(detail.id);

    routeMock.pathname = "/announcements";
    routeMock.entryKey = "announcements-list-entry-2";
    rerender();
    expect(serviceMocks.recordAnnouncementView).toHaveBeenCalledTimes(1);

    routeMock.announcementId = undefined;
    rerender();

    routeMock.pathname = `/announcements/${detail.id}`;
    routeMock.announcementId = detail.id;
    routeMock.entryKey = "announcement-detail-entry-2";
    rerender();

    await waitFor(() => expect(serviceMocks.recordAnnouncementView).toHaveBeenCalledTimes(2));
    expect(serviceMocks.recordAnnouncementView.mock.calls.map(([id]) => id)).toEqual([
      detail.id,
      detail.id,
    ]);
  });

  it("waits for the detail read before recording its view", async () => {
    routeMock.pathname = "/announcements/announcement-read";
    routeMock.announcementId = "announcement-read";
    const detail = {
      id: "announcement-read",
      title: "Read after load",
      body_json: "{}",
      category: "announcement" as const,
      excerpt: "",
      pinned: false,
      view_count: 0,
      preview_media_id: null,
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
    let resolveDetail!: (value: typeof detail) => void;
    serviceMocks.fetchAnnouncement.mockImplementation(() => new Promise((resolve) => {
      resolveDetail = resolve;
    }));

    renderHook(() => useAnnouncementsController(), { wrapper: createWrapper() });

    await waitFor(() => expect(serviceMocks.fetchAnnouncement).toHaveBeenCalledWith("announcement-read"));
    expect(serviceMocks.recordAnnouncementView).not.toHaveBeenCalled();

    resolveDetail(detail);
    await waitFor(() =>
      expect(serviceMocks.recordAnnouncementView.mock.calls[0]?.[0]).toBe("announcement-read"),
    );
  });

  it("waits for a stale cached detail to finish refetching before recording its view", async () => {
    routeMock.pathname = "/announcements/announcement-read";
    routeMock.announcementId = "announcement-read";
    const detail = {
      id: "announcement-read",
      title: "Refetched detail",
      body_json: "{}",
      category: "announcement" as const,
      excerpt: "",
      pinned: false,
      view_count: 4,
      preview_media_id: null,
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
    let resolveDetail!: (value: typeof detail) => void;
    serviceMocks.fetchAnnouncement.mockImplementation(() => new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      queryKeys.announcements.detail("announcement-read"),
      { ...detail, view_count: 3 },
      { updatedAt: 0 },
    );

    renderHook(() => useAnnouncementsController(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => expect(serviceMocks.fetchAnnouncement).toHaveBeenCalledWith("announcement-read"));
    expect(serviceMocks.recordAnnouncementView).not.toHaveBeenCalled();

    resolveDetail(detail);
    await waitFor(() =>
      expect(serviceMocks.recordAnnouncementView.mock.calls[0]?.[0]).toBe("announcement-read"),
    );
  });

  it("loads additional pages without mixing results after a filter change", async () => {
    const announcement = (id: string, status: "published" | "archived") => ({
      id,
      title: id,
      body_json: "{}",
      category: "announcement" as const,
      pinned: false,
      status,
      publish_at: null,
      expires_at: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: `2026-01-0${id.endsWith("2") ? "2" : "1"}T00:00:00.000Z`,
      author: { id: "user-1", display_name: "Guild Keeper", avatar_media_id: null },
    });
    const first = announcement("announcement-1", "published");
    const second = announcement("announcement-2", "published");
    const archived = announcement("announcement-archived", "archived");

    serviceMocks.fetchAnnouncements.mockImplementation(
      async ({ page, pinned, status }: { page: number; pinned?: boolean; status?: string }) => {
        if (pinned) {
          return {
            data: [],
            total: 0,
            page: 1,
            limit: 50,
            total_pages: 1,
          };
        }
        if (status === "archived") {
          return {
            data: [archived],
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
      result.current.setStatusFilter("archived");
    });

    await waitFor(() =>
      expect(result.current.rows.map((item) => item.id)).toEqual(["announcement-archived"]),
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
      expect.objectContaining({ status: undefined }),
    ));

    act(() => result.current.setStatusFilter("draft"));
    await waitFor(() => expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
    ));

    act(() => result.current.setStatusFilter("archived"));
    await waitFor(() => expect(serviceMocks.fetchAnnouncements).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" }),
    ));
  });
});
