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
  getPasswordHashIterations,
  resolvePbkdf2Iterations,
  resolveSession,
  SESSION_COOKIE_NAME,
  SESSION_MODE_COOKIE_NAME,
  verifyPassword,
} = await import("../auth");

// Keep session fixtures inside the 90-day absolute lifetime.
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
        roleName: "Admin",
        roleColor: "red",
        roleLevel: 999,
        isActive: true,
        deletedAt: null,
        permission: "admin.users.view",
      },
    ];
    const where = vi.fn().mockResolvedValue(joinedRows);
    const leftJoin = vi.fn(() => ({ where }));
    const secondInnerJoin = vi.fn(() => ({ leftJoin }));
    const innerJoin = vi.fn(() => ({ innerJoin: secondInnerJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const resolved = await resolveSession(createContext() as never);

    expect(resolved?.user.roleId).toBe("admin");
    expect(resolved?.user).toMatchObject({ roleName: "Admin", roleColor: "red", roleLevel: 999 });
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
        roleName: "Admin",
        roleColor: "red",
        roleLevel: 999,
        isActive: true,
        deletedAt: null,
        permission: "admin.users.view",
      },
    ];
    const where = vi.fn().mockResolvedValue(joinedRows);
    const leftJoin = vi.fn(() => ({ where }));
    const secondInnerJoin = vi.fn(() => ({ leftJoin }));
    const innerJoin = vi.fn(() => ({ innerJoin: secondInnerJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const resolved = await resolveSession(createContext() as never);

    expect(resolved?.user.roleId).toBe("admin");
    expect(resolved?.user.permissions.has("admin.users.view")).toBe(true);
    expect(resolved?.user.permissions.has("admin.siteConfig.manage")).toBe(false);
    expect(resolved?.user.permissions.has("admin.storage.stock")).toBe(false);
  });

  it("deduplicates within a request without sharing cache across requests", async () => {
    const joinedRows = [
      {
        sessionId: "sess-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        sessionCreatedAt: RECENT_SESSION_CREATED_AT,
        userId: "mod-1",
        roleId: "moderator",
        roleName: "Moderator",
        roleColor: "#756047",
        roleLevel: 500,
        isActive: true,
        deletedAt: null,
        permission: "events.create",
      },
    ];
    const where = vi.fn().mockResolvedValue(joinedRows);
    const leftJoin = vi.fn(() => ({ where }));
    const secondInnerJoin = vi.fn(() => ({ leftJoin }));
    const innerJoin = vi.fn(() => ({ innerJoin: secondInnerJoin }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select });

    const firstContext = createContext();
    const first = await resolveSession(firstContext as never);
    const cached = await resolveSession(firstContext as never);
    const second = await resolveSession(createContext() as never);

    expect(first?.user.permissions.has("events.create")).toBe(true);
    expect(cached).toBe(first);
    expect(second?.user.permissions.has("events.create")).toBe(true);
    expect(select).toHaveBeenCalledTimes(2);
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
  it("creates a self-describing hash at the free-plan default strength", async () => {
    const record = await createPasswordHash("correct horse battery staple");

    expect(record.passwordHash).toMatch(/^pbkdf2-sha256\$10000\$[A-Za-z0-9+/]+=*$/);
    await expect(verifyPassword("correct horse battery staple", record.salt, record.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", record.salt, record.passwordHash)).resolves.toBe(false);
  });

  it("verifies a hash at whatever iteration count it carries", async () => {
    const legacy = await createPasswordHash("correct horse battery staple", 600_000);

    expect(legacy.passwordHash).toMatch(/^pbkdf2-sha256\$600000\$/);
    expect(getPasswordHashIterations(legacy.passwordHash)).toBe(600_000);
    await expect(verifyPassword("correct horse battery staple", legacy.salt, legacy.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", legacy.salt, legacy.passwordHash)).resolves.toBe(false);
  });

  it("rejects hashes outside the versioned format or sane iteration bounds", async () => {
    const bareHash = "d+gPm++1wHgP08FbNF4/XqcVr71FAp5Ti7pmoiY//S4=";
    const zeroSalt = "AAAAAAAAAAAAAAAAAAAAAA==";

    await expect(verifyPassword("correct horse battery staple", zeroSalt, bareHash)).resolves.toBe(false);
    await expect(verifyPassword("correct horse battery staple", zeroSalt, `pbkdf2-sha256$1$${bareHash}`)).resolves.toBe(false);
    expect(getPasswordHashIterations(bareHash)).toBeNull();
    expect(getPasswordHashIterations(`pbkdf2-sha256$99999999999$${bareHash}`)).toBeNull();
  });

  it("reads the deployment override and defaults to the free-plan cost", () => {
    expect(resolvePbkdf2Iterations({})).toBe(10_000);
    expect(resolvePbkdf2Iterations({ PBKDF2_ITERATIONS: "" })).toBe(10_000);
    expect(resolvePbkdf2Iterations({ PBKDF2_ITERATIONS: "600000" })).toBe(600_000);
    expect(() => resolvePbkdf2Iterations({ PBKDF2_ITERATIONS: "lots" })).toThrow(/PBKDF2_ITERATIONS/);
    expect(() => resolvePbkdf2Iterations({ PBKDF2_ITERATIONS: "999" })).toThrow(/PBKDF2_ITERATIONS/);
  });
});
