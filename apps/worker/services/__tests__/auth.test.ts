import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  eq: vi.fn(),
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: mocks.eq,
  };
});

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("hono/cookie", () => ({
  getCookie: mocks.getCookie,
  deleteCookie: mocks.deleteCookie,
  setCookie: mocks.setCookie,
}));

const {
  createPasswordHash,
  destroySessionById,
  passwordHashNeedsUpgrade,
  resolveSession,
  SESSION_COOKIE_NAME,
  SESSION_MODE_COOKIE_NAME,
  verifyPassword,
} = await import("../auth");

/* resolveSession 会用 MAX_ABSOLUTE_SESSION_MS（90 天）判定会话是否超过绝对寿命。
   原先这里写死 "2026-05-01"，到 2026-07-30 就跨过 90 天，三个用例集体走进
   删除分支，报 db.delete is not a function——失败原因和用例本身毫无关系。
   固定成「相对现在一天前」，日期再往后走也不会触发绝对过期。 */
const RECENT_SESSION_CREATED_AT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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
    mocks.eq.mockImplementation((_column, value) => ({ value }));
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
        sessionCreatedAt: RECENT_SESSION_CREATED_AT,
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

  it("does not synthesize missing admin permissions outside database rows", async () => {
    const joinedRows = [
      {
        sessionId: "sess-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sessionCreatedAt: RECENT_SESSION_CREATED_AT,
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
    expect(resolved?.user.permissions.has("admin.siteConfig.manage")).toBe(false);
    expect(resolved?.user.permissions.has("admin.storage.stock")).toBe(false);
  });

  it("deduplicates per-request calls and treats freshPermissions as no-op (permissions always fresh)", async () => {
    // All three resolveSession calls use the same per-request dedup cache when on the same context.
    // Calls on different contexts each issue one query.
    const joinedRows = [
      {
        sessionId: "sess-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sessionCreatedAt: RECENT_SESSION_CREATED_AT,
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

describe("destroySessionById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockImplementation((_column, value) => ({ value }));
  });

  it("deletes the already-hashed database id without hashing it again", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteRow = vi.fn(() => ({ where }));
    mocks.drizzle.mockReturnValue({ delete: deleteRow });

    await destroySessionById(createContext() as never, "stored-session-id");

    expect(mocks.eq).toHaveBeenCalledWith(expect.anything(), "stored-session-id");
    expect(where).toHaveBeenCalledWith({ value: "stored-session-id" });
    expect(mocks.getCookie).not.toHaveBeenCalled();
    expect(mocks.deleteCookie).toHaveBeenCalledTimes(2);
  });
});

describe("password hashing", () => {
  it("creates a self-describing current-strength hash", async () => {
    const record = await createPasswordHash("correct horse battery staple");

    expect(record.passwordHash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9+/]+=*$/);
    expect(passwordHashNeedsUpgrade(record.passwordHash)).toBe(false);
    await expect(verifyPassword("correct horse battery staple", record.salt, record.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", record.salt, record.passwordHash)).resolves.toBe(false);
  });

  it("verifies legacy 10,000-iteration hashes and marks them for upgrade", async () => {
    const legacyHash = "d+gPm++1wHgP08FbNF4/XqcVr71FAp5Ti7pmoiY//S4=";
    const zeroSalt = "AAAAAAAAAAAAAAAAAAAAAA==";

    await expect(verifyPassword("correct horse battery staple", zeroSalt, legacyHash)).resolves.toBe(true);
    expect(passwordHashNeedsUpgrade(legacyHash)).toBe(true);
  });
});
