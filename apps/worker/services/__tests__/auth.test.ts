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

function createDb(row: Record<string, unknown>) {
  const limit = vi.fn().mockResolvedValue([row]);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin, where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select }, calls: { select } };
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

  it("does not request role permission rows for admin sessions", async () => {
    const { db, calls } = createDb({
      sessionId: "sess-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      sessionCreatedAt: "2026-05-01T00:00:00.000Z",
      userId: "admin-1",
      roleId: "admin",
      isActive: true,
      deletedAt: null,
    });
    mocks.drizzle.mockReturnValue(db);

    const resolved = await resolveSession(createContext() as never);

    expect(resolved?.user.roleId).toBe("admin");
    expect(calls.select).toHaveBeenCalledTimes(1);
    expect(calls.select).toHaveBeenCalledWith(expect.not.objectContaining({ permissionsJson: expect.anything() }));
  });

  it("caches non-admin permission rows for read session resolution and bypasses cache for fresh permission checks", async () => {
    const sessionRow = {
      sessionId: "sess-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      sessionCreatedAt: "2026-05-01T00:00:00.000Z",
      userId: "mod-1",
      roleId: "moderator",
      isActive: true,
      deletedAt: null,
    };
    const permissionRows = [{ permission: "events.create", granted: true }];
    const limit = vi.fn().mockResolvedValue([sessionRow]);
    const where = vi
      .fn()
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce(permissionRows)
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce(permissionRows);
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin, where }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const first = await resolveSession(createContext() as never);
    const second = await resolveSession(createContext() as never);
    const fresh = await resolveSession(createContext() as never, { freshPermissions: true });

    expect(first?.user.permissions.has("events.create")).toBe(true);
    expect(second?.user.permissions.has("events.create")).toBe(true);
    expect(fresh?.user.permissions.has("events.create")).toBe(true);
    expect(select).toHaveBeenCalledTimes(5);
  });
});
