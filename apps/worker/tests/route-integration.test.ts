/**
 * Route Integration Tests
 *
 * Tests the Hono app through the full middleware stack (request-id, CORS,
 * security headers, origin check, error handler, rate limiting, session)
 * WITHOUT a running server -- uses Hono's built-in `app.request()`.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// Global polyfills for Cloudflare-only APIs used by middleware
// ---------------------------------------------------------------------------

const fakeCacheStore = new Map<string, Response>();
let fakeCachePut: (req: Request, res: Response) => Promise<void> = async (req, res) => {
  fakeCacheStore.set(req.url, res.clone());
};
const fakeCache = {
  match: async (req: Request) => fakeCacheStore.get(req.url) ?? null,
  put: (req: Request, res: Response) => fakeCachePut(req, res),
  delete: async (req: Request) => fakeCacheStore.delete(req.url),
};

function callRelease(release: (() => void) | null): void {
  if (release) release();
}

vi.stubGlobal("caches", {
  open: async () => fakeCache,
  default: fakeCache,
});

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any app import
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
  setCookie: vi.fn(),
  userListUsers: vi.fn(),
  userGetStats: vi.fn(),
  userGetUser: vi.fn(),
  badgeGetBulkUserBadges: vi.fn(),
  badgeGetUserBadges: vi.fn(),
  guildWarGetActive: vi.fn(),
  guildWarListHistory: vi.fn(),
  guildWarGetHistoryDetail: vi.fn(),
  guildWarGetAnalytics: vi.fn(),
  search: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("hono/cookie", () => ({
  getCookie: mocks.getCookie,
  deleteCookie: mocks.deleteCookie,
  setCookie: mocks.setCookie,
}));
vi.mock("../services/UserService", () => ({
  UserService: vi.fn(function UserServiceMock(this: {
    listUsers: typeof mocks.userListUsers;
    getUserStats: typeof mocks.userGetStats;
    getUser: typeof mocks.userGetUser;
  }) {
    this.listUsers = mocks.userListUsers;
    this.getUserStats = mocks.userGetStats;
    this.getUser = mocks.userGetUser;
  }),
}));
vi.mock("../services/BadgeService", () => ({
  BadgeService: vi.fn(function BadgeServiceMock(this: {
    getBulkUserBadges: typeof mocks.badgeGetBulkUserBadges;
    getUserBadges: typeof mocks.badgeGetUserBadges;
  }) {
    this.getBulkUserBadges = mocks.badgeGetBulkUserBadges;
    this.getUserBadges = mocks.badgeGetUserBadges;
  }),
}));
vi.mock("../services/GuildWarService", () => ({
  GuildWarService: vi.fn(function GuildWarServiceMock(this: {
    getActive: typeof mocks.guildWarGetActive;
    listHistory: typeof mocks.guildWarListHistory;
    getHistoryDetail: typeof mocks.guildWarGetHistoryDetail;
    getAnalytics: typeof mocks.guildWarGetAnalytics;
  }) {
    this.getActive = mocks.guildWarGetActive;
    this.listHistory = mocks.guildWarListHistory;
    this.getHistoryDetail = mocks.guildWarGetHistoryDetail;
    this.getAnalytics = mocks.guildWarGetAnalytics;
  }),
  toWarHistoryPayload: (row: unknown) => row,
}));
vi.mock("../services/SearchService", () => ({
  SearchService: vi.fn(function SearchServiceMock(this: { search: typeof mocks.search }) {
    this.search = mocks.search;
  }),
}));

// ---------------------------------------------------------------------------
// Import the app after mocks are in place
// ---------------------------------------------------------------------------

type Bindings = import("../index").Bindings;

let app: Hono<{ Bindings: Bindings; Variables: { requestId: string; user: unknown } }>;

/** Minimal mock bindings that satisfy the Bindings type. */
function createMockEnv(featureFlags?: Record<string, boolean>): Bindings {
  // Shape matches the single site_config row read by routes/service-factory.ts.
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => featureFlags
          ? {
              absence_policy_json: null,
              feature_flags_json: JSON.stringify(featureFlags),
              media_policy_json: null,
              storage_policy_json: null,
            }
          : null,
      }),
    }),
  };
  return {
    DB: db as unknown as D1Database,
    MEDIA: {} as R2Bucket,
    WS: {} as DurableObjectNamespace,
    ASSETS: { fetch: () => new Response("not found", { status: 404 }) } as unknown as Fetcher,
    PORTAL_ORIGIN: "https://portal.example.com",
    ENVIRONMENT: "test",
    SIGNING_SECRET: "test-secret",
    SITE_NAME: "Test Guild",
    SITE_LOGO_URL: "/guild-logo.webp",
  } as unknown as Bindings;
}

/**
 * Helper: send a request through the full middleware stack.
 * Passes mock env bindings as the second argument so Hono
 * populates `c.env` correctly.
 */
async function appRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.request(path, init, createMockEnv());
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Default: no session cookie
  mocks.getCookie.mockReturnValue(undefined);
  mocks.drizzle.mockReturnValue({});

  const mod = await import("../index");
  app = mod.app as typeof app;
});

// =========================================================================
// 1. Health endpoint
// =========================================================================

describe("GET /api/health", () => {
  it("returns 200 with ok:true when DB is healthy", async () => {
    // Mock DB.prepare().first() to return { ok: 1 }
    const mockEnv = createMockEnv();
    (mockEnv.DB as unknown as Record<string, unknown>).prepare = () => ({
      bind: () => ({
        first: async () => ({ ok: 1 }),
      }),
      first: async () => ({ ok: 1 }),
    });

    const res = await app.request("/api/health", undefined, mockEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; request_id?: string };
    expect(body.ok).toBe(true);
    expect(body.request_id).toBeDefined();
  });

  it("returns 503 when DB is unreachable", async () => {
    const mockEnv = createMockEnv();
    (mockEnv.DB as unknown as Record<string, unknown>).prepare = () => ({
      bind: () => ({
        first: async () => {
          throw new Error("DB gone");
        },
      }),
      first: async () => {
        throw new Error("DB gone");
      },
    });

    const res = await app.request("/api/health", undefined, mockEnv);
    expect(res.status).toBe(503);

    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

// =========================================================================
// 2. Request ID middleware
// =========================================================================

describe("Request ID middleware", () => {
  it("attaches X-Request-Id header to every response", async () => {
    const mockEnv = createMockEnv();
    (mockEnv.DB as unknown as Record<string, unknown>).prepare = () => ({
      first: async () => ({ ok: 1 }),
    });

    const res = await app.request("/api/health", undefined, mockEnv);
    const requestId = res.headers.get("X-Request-Id");
    expect(requestId).toBeTruthy();
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

// =========================================================================
// 3. Security headers middleware
// =========================================================================

describe("Security headers middleware", () => {
  it("includes standard security headers on responses", async () => {
    const mockEnv = createMockEnv();
    (mockEnv.DB as unknown as Record<string, unknown>).prepare = () => ({
      first: async () => ({ ok: 1 }),
    });

    const res = await app.request("/api/health", undefined, mockEnv);

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});

// =========================================================================
// 4. CORS middleware
// =========================================================================

describe("CORS middleware", () => {
  it("returns CORS headers for allowed origin", async () => {
    const mockEnv = createMockEnv();
    (mockEnv.DB as unknown as Record<string, unknown>).prepare = () => ({
      first: async () => ({ ok: 1 }),
    });

    const res = await app.request(
      "/api/health",
      { headers: { Origin: "https://portal.example.com" } },
      mockEnv,
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://portal.example.com");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not return Access-Control-Allow-Origin for disallowed origin", async () => {
    const mockEnv = createMockEnv();
    (mockEnv.DB as unknown as Record<string, unknown>).prepare = () => ({
      first: async () => ({ ok: 1 }),
    });

    const res = await app.request(
      "/api/health",
      { headers: { Origin: "https://evil.example.com" } },
      mockEnv,
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// =========================================================================
// 5. Protected admin endpoint — unauthenticated
// =========================================================================

describe("Admin route auth guard", () => {
  it("returns 401 for unauthenticated request to /api/admin/roles", async () => {
    // No session cookie
    mocks.getCookie.mockReturnValue(undefined);

    const res = await appRequest("/api/admin/roles");
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error_code: string; message: string; request_id: string };
    expect(body.error_code).toBe("UNAUTHORIZED");
    expect(body.message).toBeDefined();
    expect(body.request_id).toBeDefined();
  });

  it("returns 401 for request with invalid session cookie to /api/admin/roles", async () => {
    // Session cookie is set but DB returns no matching row
    mocks.getCookie.mockImplementation((_c: unknown, name: string) => {
      if (name === "ig_session") return "invalid-session-id";
      if (name === "ig_session_mode") return "0";
      return undefined;
    });

    // Drizzle chain mock: select().from().innerJoin().leftJoin().where() => []
    const where = vi.fn().mockResolvedValue([]);
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const res = await appRequest("/api/admin/roles");
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error_code: string; message: string; request_id: string };
    expect(body.error_code).toBe("UNAUTHORIZED");
    expect(body.request_id).toBeDefined();
  });
});

// =========================================================================
// 6. Error handler — standard error shape
// =========================================================================

describe("Error handler", () => {
  it("returns 404 for unknown API routes", async () => {
    const res = await appRequest("/api/nonexistent-route-xyz");
    expect(res.status).toBe(404);
    // Hono's default 404 returns plain text "404 Not Found".
    // Security headers should still be present even on 404.
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});

// =========================================================================
// 7. Origin / CSRF protection for mutations
// =========================================================================

describe("Origin / CSRF protection", () => {
  it("rejects POST to /api/* without Origin header with 403", async () => {
    const res = await appRequest("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test", password: "test" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe("FORBIDDEN");
    expect(body.message).toContain("Origin");
  });

  it("rejects POST with disallowed Origin with 403", async () => {
    const res = await appRequest("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({ username: "test", password: "test" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe("FORBIDDEN");
  });

  it("rejects POST with valid Origin but missing X-Requested-With with 403", async () => {
    const res = await appRequest("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ username: "test", password: "test" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe("FORBIDDEN");
    expect(body.message).toContain("required header");
  });
});

// =========================================================================
// 8. Site config endpoint (public, no auth)
// =========================================================================

describe("GET /api/site-config", () => {
  it("returns site configuration without authentication", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const res = await appRequest("/api/site-config");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { site_name: string; features: Record<string, boolean> };
    expect(body.site_name).toBe("Test Guild");
    expect(body.features).toBeDefined();
    expect(body.features.announcements).toBe(true);
  });
});

describe("API request body limits", () => {
  it("rejects ordinary API bodies larger than 1 MiB before route parsing", async () => {
    const res = await appRequest("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portal.example.com",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test", password: "x".repeat(1024 * 1024) }),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
  });

  it("classifies upload paths for the 32 MiB request limit", async () => {
    const { getApiRequestBodyLimit } = await import("../index");

    expect(getApiRequestBodyLimit("/api/gallery/images")).toBe(32 * 1024 * 1024);
    expect(getApiRequestBodyLimit("/api/announcements/images/stage")).toBe(32 * 1024 * 1024);
    expect(getApiRequestBodyLimit("/api/events")).toBe(32 * 1024 * 1024);
    expect(getApiRequestBodyLimit("/api/game-data")).toBe(32 * 1024 * 1024);
    expect(getApiRequestBodyLimit("/api/users/user-1/media/avatar")).toBe(32 * 1024 * 1024);
    expect(getApiRequestBodyLimit("/api/auth/login")).toBe(1024 * 1024);
    expect(getApiRequestBodyLimit("/api/not-real/gallery/images")).toBe(1024 * 1024);
  });
});

// =========================================================================
// 9. Public read APIs used by guest pages
// =========================================================================

describe("Guest read API access", () => {
  it("returns the roster without authentication", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    mocks.userListUsers.mockResolvedValueOnce({
      ok: true,
      data: {
        data: [{ user: { id: "u-1", username: "guest-visible" }, profile: {} }],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      },
    });
    mocks.badgeGetBulkUserBadges.mockResolvedValueOnce(new Map([["u-1", []]]));

    const res = await appRequest("/api/users?page=1&limit=20&active=false");

    expect(res.status).toBe(200);
    expect(mocks.userListUsers).toHaveBeenCalledWith(expect.objectContaining({ activeFilter: true, sessionUser: null }));
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("returns member stats without authentication", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    mocks.userGetStats.mockResolvedValueOnce({ ok: true, data: { active_members: 1, total_members: 1 } });

    const res = await appRequest("/api/users/stats");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active_members: 1, total_members: 1 });
  });

  it("returns a public member profile without authentication", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    mocks.userGetUser.mockResolvedValueOnce({
      ok: true,
      data: { user: { id: "u-1", username: "guest-visible" }, profile: {} },
    });
    mocks.badgeGetUserBadges.mockResolvedValueOnce([]);

    const res = await appRequest("/api/users/u-1");

    expect(res.status).toBe(200);
    expect(mocks.userGetUser).toHaveBeenCalledWith(null, "u-1");
  });

  it("returns guild war read data without authentication", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    mocks.guildWarListHistory.mockResolvedValueOnce({ ok: true, data: { data: [], total: 0, page: 1, limit: 5, total_pages: 1 } });
    mocks.guildWarGetAnalytics.mockResolvedValueOnce({ ok: true, data: { wars: [], member_stats: [], analytics_settings: {} } });
    mocks.guildWarGetActive.mockResolvedValueOnce({ ok: true, data: { event: null, teams: [], pool: [] } });

    const history = await appRequest("/api/guild-war/history?page=1&limit=5");
    const analytics = await appRequest("/api/guild-war/analytics");
    const active = await appRequest("/api/guild-war/active");

    expect(history.status).toBe(200);
    expect(analytics.status).toBe(200);
    expect(active.status).toBe(200);
  });

  it("returns 404 for a disabled feature API", async () => {
    const env = createMockEnv({
      announcements: true,
      events: false,
      guildWar: true,
      gallery: true,
      wiki: true,
      tools: true,
      equipmentCalc: true,
      storage: true,
    });

    const res = await app.request("/api/events", undefined, env);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error_code: "NOT_FOUND",
      message: "Feature is disabled",
    });
  });

  it("returns global search without authentication", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    mocks.search.mockResolvedValueOnce({ ok: true, data: { data: [] } });

    const res = await appRequest("/api/search?q=test&limit=5");

    expect(res.status).toBe(200);
  });

  it("returns dashboard summary without authentication", async () => {
    mocks.getCookie.mockReturnValue(undefined);

    const eventRow = (id: string, pinned: boolean) => ({
      id,
      type: "social",
      title: id,
      description: null,
      startAt: "2026-08-01T20:00:00.000Z",
      endAt: null,
      capacity: null,
      pinned,
      signupLocked: false,
      visibleAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
      autoArchive: false,
      autoArchived: false,
      createdBy: "user-1",
      updatedBy: null,
      attachments: null,
      seriesId: null,
      instanceDate: null,
      winnerCount: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    let selectCall = 0;
    const select = vi.fn(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return { from: vi.fn().mockResolvedValue([{ activeMembers: 1, totalMembers: 1 }]) };
      }
      if (selectCall === 2) {
        return { from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([eventRow("featured", true)]) })) })) })) };
      }
      if (selectCall === 3) {
        return { from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([eventRow("regular", false)]) })) })) })) };
      }
      if (selectCall === 4) {
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ total: 8 }]) })) };
      }
      if (selectCall === 5) {
        return { from: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) };
      }
      if (selectCall === 6) {
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ total: 0, wins: 0 }]) })) };
      }
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      };
    });
    mocks.drizzle.mockReturnValueOnce({ select });

    const res = await appRequest("/api/dashboard/summary");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      active_member_count: number;
      active_events_count: number;
      featured_events: Array<{ id: string }>;
      upcoming_events: Array<{ id: string }>;
      my_signup_event_ids: string[];
    };
    expect(body.active_member_count).toBe(1);
    expect(body.active_events_count).toBe(8);
    expect(body.featured_events.map((event) => event.id)).toEqual(["featured"]);
    expect(body.upcoming_events.map((event) => event.id)).toEqual(["regular"]);
    expect(body.my_signup_event_ids).toEqual([]);
  });
});

// =========================================================================
// 10. Validation error (400) for malformed request body
// =========================================================================

describe("Zod validation error", () => {
  it("returns 400 with VALIDATION_ERROR for invalid login payload", async () => {
    const res = await appRequest("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portal.example.com",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error_code: string; message: string; request_id: string };
    expect(body.error_code).toBe("VALIDATION_ERROR");
    expect(body.request_id).toBeDefined();
  });
});

// =========================================================================
// 11. Rate limiting (429)
// =========================================================================

describe("Rate limiting", () => {
  it("returns 429 when rate limit is exceeded", async () => {
    // Pre-seed the fake cache with a bucket that already exceeded the limit.
    // The auth login rate limiter uses keyPrefix "auth" with windowMs 60000.
    // We compute the current window ID and build the cache key accordingly.
    const windowMs = 60_000;
    const windowId = Math.floor(Date.now() / windowMs);
    const cacheKey = `https://rate-limit-v1/auth/unknown/${windowId}`;
    const bucket = { count: 999, resetAt: (windowId + 1) * windowMs };
    fakeCacheStore.set(cacheKey, new Response(JSON.stringify(bucket), {
      headers: { "Content-Type": "application/json" },
    }));

    const res = await appRequest("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portal.example.com",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test", password: "test" }),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error_code: string; message: string; request_id: string };
    expect(body.error_code).toBe("RATE_LIMITED");
    expect(body.request_id).toBeDefined();
    expect(res.headers.get("Retry-After")).toBeTruthy();

    // Cleanup
    fakeCacheStore.delete(cacheKey);
  });

  it("can defer successful read counter writes without blocking the response", async () => {
    const { createRateLimitMiddleware } = await import("../middleware/rate-limit");
    const pendingWrites: Promise<void>[] = [];
    let releasePut: (() => void) | null = null;
    let putStarted = false;
    const previousPut = fakeCachePut;
    fakeCachePut = async (req, res) => {
      putStarted = true;
      await new Promise<void>((resolve) => {
        releasePut = () => {
          fakeCacheStore.set(req.url, res.clone());
          resolve();
        };
      });
    };

    const headers = new Headers();
    const middleware = createRateLimitMiddleware({
      keyPrefix: "read-test",
      maxRequests: 120,
      windowMs: 60_000,
      deferWrite: true,
    });
    const context = {
      req: {
        header: () => undefined,
      },
      header: (name: string, value: string) => {
        headers.set(name, value);
      },
      get: () => "test-request-id",
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
      executionCtx: {
        waitUntil: (promise: Promise<unknown>) => {
          pendingWrites.push(promise as Promise<void>);
        },
      },
    };
    let nextCalled = false;

    try {
      const run = middleware(context as never, async () => {
        nextCalled = true;
      });
      await vi.waitFor(() => expect(nextCalled).toBe(true));
      expect(putStarted).toBe(true);
      expect(pendingWrites).toHaveLength(1);
      callRelease(releasePut);
      await run;
      await Promise.all(pendingWrites);
    } finally {
      callRelease(releasePut);
      fakeCachePut = previousPut;
    }
  });

  it("keeps strict counter writes blocking before continuing", async () => {
    const { createRateLimitMiddleware } = await import("../middleware/rate-limit");
    let releasePut: (() => void) | null = null;
    const previousPut = fakeCachePut;
    fakeCachePut = async (req, res) => {
      await new Promise<void>((resolve) => {
        releasePut = () => {
          fakeCacheStore.set(req.url, res.clone());
          resolve();
        };
      });
    };

    const headers = new Headers();
    const middleware = createRateLimitMiddleware({
      keyPrefix: "strict-test",
      maxRequests: 120,
      windowMs: 60_000,
    });
    const context = {
      req: {
        header: () => undefined,
      },
      header: (name: string, value: string) => {
        headers.set(name, value);
      },
      get: () => "test-request-id",
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
    };
    let nextCalled = false;
    const run = middleware(context as never, async () => {
      nextCalled = true;
    });

    try {
      await vi.waitFor(() => expect(releasePut).toBeTypeOf("function"));
      expect(nextCalled).toBe(false);
      callRelease(releasePut);
      await run;
      expect(nextCalled).toBe(true);
    } finally {
      callRelease(releasePut);
      fakeCachePut = previousPut;
    }
  });
});
