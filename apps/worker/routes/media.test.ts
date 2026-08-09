import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  resolveReadableVariant: vi.fn(),
  serveR2Object: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock("../services/MediaService", () => ({
  MediaService: vi.fn(function MediaServiceMock(this: { resolveReadableVariant: typeof mocks.resolveReadableVariant }) {
    this.resolveReadableVariant = mocks.resolveReadableVariant;
  }),
}));
vi.mock("./_shared", async () => {
  const actual = await vi.importActual<typeof import("./_shared")>("./_shared");
  return { ...actual, serveR2Object: mocks.serveR2Object };
});

describe("GET /api/media/:mediaId/:variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUser.mockResolvedValue(null);
    mocks.serveR2Object.mockResolvedValue(new Response("media"));
  });

  it("resolves authorization from D1 and serves only the internal R2 key", async () => {
    const mediaId = "Abcdefghijklmnopqrstu";
    mocks.resolveReadableVariant.mockResolvedValue({
      r2Key: `media/${mediaId}/view.webp`,
      contentType: "image/webp",
    });
    const { mediaRoutes } = await import("./media");
    const response = await mediaRoutes.request(
      `/${mediaId}/view`,
      {},
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveReadableVariant).toHaveBeenCalledWith(expect.objectContaining({
      mediaId,
      variant: "view",
      session: null,
    }));
    expect(mocks.serveR2Object).toHaveBeenCalledWith(
      expect.anything(),
      `media/${mediaId}/view.webp`,
      "Media not found",
      "image/webp",
    );
    expect(await response.text()).toBe("media");
  });

  it("returns the same 404 for invalid variants and denied reads", async () => {
    const mediaId = "Abcdefghijklmnopqrstu";
    const { mediaRoutes } = await import("./media");
    const invalid = await mediaRoutes.request(`/${mediaId}/original`, {}, { DB: {}, MEDIA: {} });
    expect(invalid.status).toBe(404);
    expect(mocks.resolveReadableVariant).not.toHaveBeenCalled();

    mocks.resolveReadableVariant.mockResolvedValueOnce(null);
    const denied = await mediaRoutes.request(`/${mediaId}/full`, {}, { DB: {}, MEDIA: {} });
    expect(denied.status).toBe(404);
    expect(mocks.serveR2Object).not.toHaveBeenCalled();
  });
});
