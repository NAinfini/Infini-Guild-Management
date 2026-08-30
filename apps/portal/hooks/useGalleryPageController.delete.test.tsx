import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { GalleryItem } from "@guild/shared";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { notifyError } from "../utils/notifications";
import { useGalleryPageController } from "./useGalleryPageController";

const serviceMocks = vi.hoisted(() => ({
  batchDeleteGalleryItems: vi.fn(),
  createGalleryVideo: vi.fn(),
  deleteGalleryItem: vi.fn(),
  fetchGallery: vi.fn(),
  likeGalleryItem: vi.fn(),
  unlikeGalleryItem: vi.fn(),
  updateGalleryItem: vi.fn(),
  uploadGalleryImages: vi.fn(),
}));
const showError = vi.hoisted(() => vi.fn());

vi.mock("../services/GalleryService", () => serviceMocks);
vi.mock("../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("../stores/site-config", () => ({
  requireSiteMediaPolicy: (state: { mediaPolicy: { quotas: { gallery: number } } }) => state.mediaPolicy,
  useSiteConfigStore: (selector: (state: { mediaPolicy: { quotas: { gallery: number } } }) => unknown) =>
    selector({ mediaPolicy: { quotas: { gallery: 20 } } }),
}));
vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({ canManage: () => true }),
}));
vi.mock("./useExternalView", () => ({ useExternalView: () => false }));
vi.mock("./useAppError", () => ({ useAppError: () => ({ showError }) }));
vi.mock("./useBeforeUnloadPrompt", () => ({ useBeforeUnloadPrompt: vi.fn() }));
vi.mock("./useLoadWarningToast", () => ({ useLoadWarningToast: vi.fn() }));
vi.mock("./useDebouncedSearch", () => ({
  useDebouncedSearch: () => ({ search: "", setSearch: vi.fn(), debouncedSearch: "" }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../utils/notifications", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function galleryItem(revisionToken: string): GalleryItem {
  return {
    id: "gallery-1",
    type: "image",
    media_id: "123456789012345678901",
    url: null,
    title: "Original",
    description: null,
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    like_count: 0,
    liked_by_viewer: false,
    created_at: "2026-08-09T00:00:00.000Z",
    revision_token: revisionToken,
  };
}

describe("useGalleryPageController", () => {
  beforeEach(() => {
    showError.mockReset();
    vi.mocked(notifyError).mockReset();
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
  });

  it("freezes the confirmed item ETag across a refresh and keeps the failed confirmation retryable", async () => {
    const original = galleryItem("revision-original");
    const refreshed = galleryItem("revision-remote");
    serviceMocks.fetchGallery.mockResolvedValue({ data: [original], next_cursor: null });
    serviceMocks.deleteGalleryItem
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({ ok: true });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useGalleryPageController(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.rows).toEqual([original]));
    let deleteResult!: Promise<boolean>;
    act(() => {
      deleteResult = result.current.handleDeleteItem(original);
    });
    await waitFor(() => expect(result.current.deleteTargetId).toBe(original.id));

    act(() => {
      queryClient.setQueryData(queryKeys.gallery.list("desc", "all", "none", "none", "none"), {
        pages: [{ data: [refreshed], next_cursor: null }],
        pageParams: [undefined],
      });
    });
    await waitFor(() => expect(result.current.rows).toEqual([refreshed]));

    await act(async () => {
      await expect(result.current.confirmDeleteItem()).resolves.toBe(false);
    });
    expect(serviceMocks.deleteGalleryItem).toHaveBeenCalledWith(
      original.id,
      '"gallery-gallery-1-revision-original"',
    );
    expect(result.current.deleteTargetId).toBe(original.id);

    await act(async () => {
      await expect(result.current.confirmDeleteItem()).resolves.toBe(true);
    });
    await expect(deleteResult).resolves.toBe(true);
    expect(result.current.deleteTargetId).toBeNull();
    expect(serviceMocks.deleteGalleryItem).toHaveBeenLastCalledWith(
      original.id,
      '"gallery-gallery-1-revision-original"',
    );
  });

  it("updates the cached lightbox item with the ETag captured from the edited revision", async () => {
    const original = galleryItem("revision-original");
    const updated = {
      ...original,
      title: "Guild night",
      description: "A clear night",
      revision_token: "revision-updated",
    };
    serviceMocks.fetchGallery.mockResolvedValue({ data: [original], next_cursor: null });
    serviceMocks.updateGalleryItem.mockResolvedValue(updated);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useGalleryPageController(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.rows).toEqual([original]));
    await act(async () => {
      await expect(result.current.updateGalleryMetadata(original, {
        title: "Guild night",
        description: "A clear night",
      })).resolves.toBe(true);
    });

    expect(serviceMocks.updateGalleryItem).toHaveBeenCalledWith(
      original.id,
      { title: "Guild night", description: "A clear night" },
      '"gallery-gallery-1-revision-original"',
    );
    await waitFor(() => expect(result.current.rows).toEqual([updated]));
  });

  it("uploads the queued images in one request", async () => {
    serviceMocks.fetchGallery.mockResolvedValue({ data: [], next_cursor: null });
    serviceMocks.uploadGalleryImages.mockResolvedValue({ data: [] });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useGalleryPageController(), {
      wrapper: createWrapper(queryClient),
    });
    const files = [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
    ];

    act(() => result.current.selectFiles(files));
    await waitFor(() => expect(result.current.uploadQueue).toHaveLength(2));
    await act(async () => result.current.runUploadQueue());

    expect(serviceMocks.uploadGalleryImages).toHaveBeenCalledTimes(1);
    expect(serviceMocks.uploadGalleryImages).toHaveBeenCalledWith(
      files,
      [
        { title: "one", description: undefined },
        { title: "two", description: undefined },
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect(result.current.uploadQueue.every((task) => task.status === "done")).toBe(true));
  });

  it("keeps failed upload tasks retryable while delegating a network failure to the shared presenter", async () => {
    const networkFailure = new ApiRequestError("Network unavailable", { status: 0 });
    serviceMocks.fetchGallery.mockResolvedValue({ data: [], next_cursor: null });
    serviceMocks.uploadGalleryImages.mockRejectedValue(networkFailure);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useGalleryPageController(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => result.current.selectFiles([new File(["image"], "warden.png", { type: "image/png" })]));
    await waitFor(() => expect(result.current.uploadQueue).toHaveLength(1));
    await act(async () => result.current.runUploadQueue());

    await waitFor(() => expect(result.current.uploadQueue[0]).toMatchObject({
      status: "error",
      error: "message.uploadTaskFailed",
    }));
    expect(showError).toHaveBeenCalledWith(networkFailure, "message.uploadBatchFailed");
    expect(notifyError).not.toHaveBeenCalled();
  });
});
