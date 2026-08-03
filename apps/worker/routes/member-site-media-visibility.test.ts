import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  getPublicConfig: vi.fn(),
  serveR2Object: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  getRequestUser: mocks.getRequestUser,
}));

vi.mock("../services/SiteConfigService", async () => {
  const actual = await vi.importActual<typeof import("../services/SiteConfigService")>("../services/SiteConfigService");
  return {
    ...actual,
    SiteConfigService: vi.fn(function SiteConfigServiceMock(this: { getPublicConfig: typeof mocks.getPublicConfig }) {
      this.getPublicConfig = mocks.getPublicConfig;
    }),
  };
});

vi.mock("./service-factory", () => ({
  commonDeps: vi.fn(() => ({
    writeAuditLog: vi.fn(),
    publishEntityChanged: vi.fn(),
  })),
}));

vi.mock("./_shared", async () => {
  const actual = await vi.importActual<typeof import("./_shared")>("./_shared");
  return {
    ...actual,
    getDb: vi.fn(() => ({})),
    serveR2Object: mocks.serveR2Object,
  };
});

function dbWithReference(reference: { present: number } | null) {
  const first = vi.fn().mockResolvedValue(reference);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { DB: { prepare }, prepare, bind, first };
}

describe("member and site media visibility", () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset().mockResolvedValue(null);
    mocks.getPublicConfig.mockReset();
    mocks.serveR2Object.mockReset().mockResolvedValue(new Response("image"));
  });

  it("does not serve an unreferenced object merely because it has a member prefix", async () => {
    const { usersRoutes } = await import("./users");
    const env = dbWithReference(null);

    const response = await usersRoutes.request(
      "/image?key=members%2Fu-1%2Fimages%2Fobject-1.webp",
      { method: "GET" },
      { DB: env.DB, MEDIA: {} },
    );

    expect(response.status).toBe(404);
    expect(env.bind).toHaveBeenCalledWith("u-1", 0, "members/u-1/images/object-1.webp");
    expect(mocks.serveR2Object).not.toHaveBeenCalled();
  });

  it("serves an exactly referenced member object", async () => {
    const { usersRoutes } = await import("./users");
    const env = dbWithReference({ present: 1 });

    const response = await usersRoutes.request(
      "/image?key=members%2Fu-1%2Faudio%2Fobject-1.ogg",
      { method: "GET" },
      { DB: env.DB, MEDIA: {} },
    );

    expect(response.status).toBe(200);
    expect(mocks.serveR2Object).toHaveBeenCalledWith(
      expect.anything(),
      "members/u-1/audio/object-1.ogg",
      "Profile media not found",
    );
  });

  it("does not serve a stale site-logo object with the right prefix", async () => {
    const { siteConfigRoutes } = await import("./site-config");
    mocks.getPublicConfig.mockResolvedValueOnce({
      ok: true,
      data: { site_logo_url: "/api/site-config/logo?key=site%2Flogo%2Fcurrent.webp" },
    });

    const response = await siteConfigRoutes.request(
      "/logo?key=site%2Flogo%2Fold.webp",
      { method: "GET" },
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(404);
    expect(mocks.serveR2Object).not.toHaveBeenCalled();
  });

  it("serves only the currently configured site-logo object", async () => {
    const { siteConfigRoutes } = await import("./site-config");
    mocks.getPublicConfig.mockResolvedValueOnce({
      ok: true,
      data: { site_logo_url: "/api/site-config/logo?key=site%2Flogo%2Fcurrent.webp" },
    });

    const response = await siteConfigRoutes.request(
      "/logo?key=site%2Flogo%2Fcurrent.webp",
      { method: "GET" },
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(200);
    expect(mocks.serveR2Object).toHaveBeenCalledWith(
      expect.anything(),
      "site/logo/current.webp",
      "Site logo not found",
    );
  });
});
