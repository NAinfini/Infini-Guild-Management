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
}));

vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("hono/cookie", () => ({
  getCookie: mocks.getCookie,
  deleteCookie: mocks.deleteCookie,
  setCookie: mocks.setCookie,
}));

// ---------------------------------------------------------------------------
// Import the app after mocks are in place
// ---------------------------------------------------------------------------

type Bindings = import("../index").Bindings;

let app: Hono<{ Bindings: Bindings; Variables: { requestId: string; user: unknown } }>;

/** Minimal mock bindings that satisfy the Bindings type. */
function createMockEnv(): Bindings {
  return {
    DB: {} as D1Database,
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

    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(false);
    expect(body.db).toBe("unreachable");
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

    // Drizzle chain mock: select().from().innerJoin().where().limit() => []
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const innerJoin = vi.fn(() => ({ where }));
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
    const res = await appRequest("/api/site-config");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { site_name: string; features: Record<string, boolean> };
    expect(body.site_name).toBe("Test Guild");
    expect(body.features).toBeDefined();
    expect(body.features.announcements).toBe(true);
  });
});

// =========================================================================
// 9. Validation error (400) for malformed request body
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
// 10. Rate limiting (429)
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
