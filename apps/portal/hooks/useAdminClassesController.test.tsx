import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { catalogRevisionToken } from "@guild/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { notifyError } from "../utils/notifications";
import { useAdminClassesController } from "./useAdminClassesController";

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  removeIcon: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  fetch: vi.fn(),
}));
const presentAppError = vi.hoisted(() => vi.fn());

vi.mock("../api/mutations/classes", () => ({
  createClassCatalogItem: apiMocks.create,
  updateClassCatalogItem: apiMocks.update,
  uploadClassCatalogIcon: apiMocks.upload,
  removeClassCatalogIcon: apiMocks.removeIcon,
  deleteClassCatalogItem: apiMocks.remove,
  reorderClassCatalog: apiMocks.reorder,
}));

vi.mock("../api/queries/classes", () => ({
  fetchClassCatalog: apiMocks.fetch,
}));

vi.mock("../utils/notifications", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("./useAppError", () => ({ presentAppError }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const vectorItem = {
  id: "generated-class-id",
  label: "Warden",
  color: "#61B8AA",
  icon_type: "vector" as const,
  vector_icon: "shield" as const,
  icon_media_id: null,
  sort_order: 10,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
};

const catalog = [
  { ...vectorItem, id: "warden", label: "Warden", sort_order: 0 },
  { ...vectorItem, id: "seer", label: "Seer", sort_order: 10 },
  { ...vectorItem, id: "ranger", label: "Ranger", sort_order: 20 },
];

function createWrapper(queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAdminClassesController", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    vi.mocked(notifyError).mockReset();
    presentAppError.mockReset();
    apiMocks.fetch.mockResolvedValue([]);
    apiMocks.create.mockResolvedValue(vectorItem);
    apiMocks.update.mockResolvedValue(vectorItem);
    apiMocks.remove.mockResolvedValue({ deleted: true });
  });

  it("turns a partially created image class into an editable retry instead of duplicating it", async () => {
    apiMocks.upload
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValueOnce({
        ...vectorItem,
        icon_type: "image",
        vector_icon: null,
        icon_media_id: "class1234567890abcdef",
      });
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    act(() => result.current.openCreate());
    act(() => {
      result.current.setDraft((current) => ({
        ...current,
        label: "Warden",
        color: "#61B8AA",
        vectorIcon: "shield",
        iconMode: "image",
        imageFile: new File(["image"], "warden.png", { type: "image/png" }),
      }));
    });
    await waitFor(() => expect(result.current.draft.label).toBe("Warden"));
    act(() => result.current.save());

    await waitFor(() => {
      expect(apiMocks.upload).toHaveBeenCalledTimes(1);
      expect(result.current.savePending).toBe(false);
      expect(result.current.draft.id).toBe("generated-class-id");
    });

    act(() => result.current.save());
    await waitFor(() => expect(apiMocks.upload).toHaveBeenCalledTimes(2));

    expect(apiMocks.create).toHaveBeenCalledTimes(1);
    expect(apiMocks.update).toHaveBeenCalledTimes(1);
    expect(apiMocks.update).toHaveBeenCalledWith(
      "generated-class-id",
      expect.objectContaining({ label: "Warden", expected_updated_at: vectorItem.updated_at }),
    );
  });

  it("keeps saved class details retryable while delegating a lost icon upload to the shared presenter", async () => {
    const networkFailure = new ApiRequestError("Network unavailable", { status: 0 });
    apiMocks.upload.mockRejectedValue(networkFailure);
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    act(() => result.current.openCreate());
    act(() => {
      result.current.setDraft((current) => ({
        ...current,
        label: "Warden",
        iconMode: "image",
        imageFile: new File(["image"], "warden.png", { type: "image/png" }),
      }));
    });
    act(() => result.current.save());

    await waitFor(() => expect(result.current.savePending).toBe(false));
    expect(result.current.draft).toMatchObject({
      id: vectorItem.id,
      updatedAt: vectorItem.updated_at,
    });
    expect(presentAppError).toHaveBeenCalledWith(networkFailure, "classes.message.failed");
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("retries an existing image edit from the metadata revision that already persisted", async () => {
    const original = catalog[0]!;
    const metadataSaved = {
      ...original,
      label: "Warden Prime",
      updated_at: "2026-07-29T00:00:01.000Z",
    };
    apiMocks.fetch.mockResolvedValue([original]);
    apiMocks.update.mockResolvedValue(metadataSaved);
    apiMocks.upload
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValueOnce({
        ...metadataSaved,
        icon_type: "image",
        vector_icon: null,
        icon_media_id: "class1234567890abcdef",
        updated_at: "2026-07-29T00:00:02.000Z",
      });
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.draft.id).toBe(original.id));
    act(() => result.current.setDraft((current) => ({
      ...current,
      label: metadataSaved.label,
      iconMode: "image",
      imageFile: new File(["image"], "warden.png", { type: "image/png" }),
    })));
    act(() => result.current.save());

    await waitFor(() => {
      expect(apiMocks.upload).toHaveBeenCalledTimes(1);
      expect(result.current.savePending).toBe(false);
    });
    expect(result.current.draft.updatedAt).toBe(metadataSaved.updated_at);

    act(() => result.current.save());
    await waitFor(() => expect(apiMocks.upload).toHaveBeenCalledTimes(2));
    expect(apiMocks.update).toHaveBeenLastCalledWith(
      original.id,
      expect.objectContaining({ expected_updated_at: metadataSaved.updated_at }),
    );
  });

  it("refetches the catalog once after save and renders that response", async () => {
    const refreshed = catalog.map((item, index) => index === 0
      ? { ...item, label: "Warden Prime" }
      : item);
    apiMocks.fetch.mockResolvedValueOnce(catalog).mockResolvedValue(refreshed);
    apiMocks.update.mockResolvedValue(refreshed[0]);

    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.draft.id).toBe("warden"));

    act(() => result.current.save());

    await waitFor(() => {
      expect(result.current.savePending).toBe(false);
      expect(result.current.query.data?.[0]?.label).toBe("Warden Prime");
    });
    expect(apiMocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps an existing image icon while saving only its text fields", async () => {
    const imageClass = {
      ...vectorItem,
      icon_type: "image" as const,
      vector_icon: null,
      icon_media_id: "class1234567890abcdef",
    };
    apiMocks.fetch.mockResolvedValue([imageClass]);
    apiMocks.update.mockResolvedValue({ ...imageClass, label: "Illustrated Warden" });
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.draft.id).toBe(imageClass.id));
    act(() => result.current.setDraft((current) => ({ ...current, label: "Illustrated Warden" })));
    act(() => result.current.save());

    await waitFor(() => expect(apiMocks.update).toHaveBeenCalledOnce());
    expect(apiMocks.update).toHaveBeenCalledWith(imageClass.id, expect.not.objectContaining({ vector_icon: expect.anything() }));
    expect(apiMocks.upload).not.toHaveBeenCalled();
    expect(apiMocks.removeIcon).not.toHaveBeenCalled();
  });

  it("submits a deletion with the revision captured by the confirmation", async () => {
    apiMocks.fetch.mockResolvedValue(catalog);
    apiMocks.remove.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.draft.id).toBe("warden"));
    await act(async () => { await result.current.remove("warden", catalog[0]!.updated_at); });

    expect(apiMocks.remove).toHaveBeenCalledWith("warden", catalog[0]!.updated_at);
  });

  it("clears the dirty state when an editor draft returns exactly to its baseline", async () => {
    apiMocks.fetch.mockResolvedValue(catalog);
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.draft.id).toBe("warden"));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setDraft((current) => ({ ...current, label: "Warden Prime" }));
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.setDraft((current) => ({ ...current, label: "Warden" }));
    });
    expect(result.current.isDirty).toBe(false);
  });

  it("submits the whole catalog order and shows it before the server answers", async () => {
    apiMocks.fetch.mockResolvedValue(catalog);
    let resolveReorder: ((items: typeof catalog) => void) | undefined;
    apiMocks.reorder.mockReturnValue(new Promise((resolve) => { resolveReorder = resolve; }));

    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.query.data).toHaveLength(3));

    act(() => result.current.reorder("ranger", "warden"));

    /* 批量接口要的是完整目录，不是「被拖的那一个」——少一个服务端就会回 409。 */
    await waitFor(() => {
      expect(apiMocks.reorder).toHaveBeenCalledWith(
        ["ranger", "warden", "seer"],
        catalogRevisionToken(catalog),
      );
    });
    await waitFor(() => {
      expect(result.current.query.data?.map((item) => item.id))
        .toEqual(["ranger", "warden", "seer"]);
    });
    expect(result.current.reorderPending).toBe(true);

    const saved = [catalog[2]!, catalog[0]!, catalog[1]!];
    await act(async () => { resolveReorder?.(saved); });
    await waitFor(() => expect(result.current.reorderPending).toBe(false));
  });

  it("puts the list back and refetches when the server rejects a stale order", async () => {
    apiMocks.fetch.mockResolvedValue(catalog);
    const orderFailure = new Error("Class order must list all 4 classes; received 3");
    apiMocks.reorder.mockRejectedValue(orderFailure);

    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.query.data).toHaveLength(3));

    await act(async () => { result.current.reorder("ranger", "warden"); });

    /* 失败必须看得见：顺序回到拖之前，并且把错误弹出来，不能停在乐观顺序上
       让人以为存住了。 */
    await waitFor(() => {
      expect(result.current.query.data?.map((item) => item.id))
        .toEqual(["warden", "seer", "ranger"]);
    });
    expect(presentAppError).toHaveBeenCalledWith(orderFailure, "classes.message.reorderFailed");
  });

  it("ignores a drop that lands the class back on itself", async () => {
    apiMocks.fetch.mockResolvedValue(catalog);
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.query.data).toHaveLength(3));

    act(() => result.current.reorder("seer", "seer"));

    expect(apiMocks.reorder).not.toHaveBeenCalled();
  });

  it("keeps a dirty editor's form-open revision when a background refresh changes that class", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMocks.fetch.mockResolvedValue(catalog);
    const { result } = renderHook(() => useAdminClassesController(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.draft.id).toBe("warden"));
    act(() => result.current.setDraft((current) => ({ ...current, label: "Unsaved Warden" })));
    const refreshed = catalog.map((item) => item.id === "warden"
      ? { ...item, label: "Remote Warden", updated_at: "2026-07-29T00:00:01.000Z" }
      : item);
    act(() => queryClient.setQueryData(queryKeys.classes.list(), refreshed));

    await waitFor(() => expect(result.current.query.data?.[0]?.label).toBe("Remote Warden"));
    expect(result.current.draft.label).toBe("Unsaved Warden");
    expect(result.current.draft.updatedAt).toBe(vectorItem.updated_at);
  });
});
