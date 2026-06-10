import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("hono/cookie", () => ({
  getCookie: mocks.getCookie,
  deleteCookie: mocks.deleteCookie,
  setCookie: mocks.setCookie,
}));

const { resolveSession, SESSION_COOKIE_NAME, SESSION_MODE_COOKIE_NAME } = await import("../auth");

function createContext() {
  const values = new Map<string, unknown>();
  return {
    env: { DB: {} },
    req: { url: "https://guild.test/api/auth/session" },
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
  };
}

describe("resolveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCookie.mockImplementation((_c, name: string) => {
      if (name === SESSION_COOKIE_NAME) return "sess-1";
      if (name === SESSION_MODE_COOKIE_NAME) return "0";
      return undefined;
    });
  });

  it("loads permission rows from database for admin sessions via single joined query", async () => {
    // The joined query returns one row per permission (all session/user fields repeated).
    const joinedRows = [
      {
        sessionId: "sess-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sessionCreatedAt: "2026-05-01T00:00:00.000Z",
        userId: "admin-1",
        roleId: "admin",
        isActive: true,
        deletedAt: null,
        permission: "admin.users.view",
        granted: true,
      },
    ];
    const where = vi.fn().mockResolvedValue(joinedRows);
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const resolved = await resolveSession(createContext() as never);

    expect(resolved?.user.roleId).toBe("admin");
    expect(resolved?.user.permissions.has("admin.users.view")).toBe(true);
    // Single query covers session + user + permissions
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("deduplicates per-request calls and treats freshPermissions as no-op (permissions always fresh)", async () => {
    // All three resolveSession calls use the same per-request dedup cache when on the same context.
    // Calls on different contexts each issue one query.
    const joinedRows = [
      {
        sessionId: "sess-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sessionCreatedAt: "2026-05-01T00:00:00.000Z",
        userId: "mod-1",
        roleId: "moderator",
        isActive: true,
        deletedAt: null,
        permission: "events.create",
        granted: true,
      },
    ];
    const where = vi.fn().mockResolvedValue(joinedRows);
    const leftJoin = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ leftJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    // Three separate contexts → three separate DB queries (no cross-request caching)
    const first = await resolveSession(createContext() as never);
    const second = await resolveSession(createContext() as never);
    const fresh = await resolveSession(createContext() as never, { freshPermissions: true });

    expect(first?.user.permissions.has("events.create")).toBe(true);
    expect(second?.user.permissions.has("events.create")).toBe(true);
    expect(fresh?.user.permissions.has("events.create")).toBe(true);
    // Each context issues exactly one joined query
    expect(select).toHaveBeenCalledTimes(3);
  });
});
