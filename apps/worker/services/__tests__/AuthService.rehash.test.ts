import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../AuthService";

const B64_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function account(passwordHash: string) {
  return {
    id: "user-1",
    username: "Veteran",
    role: "member",
    roleName: "Member",
    roleColor: "gray",
    roleLevel: 100,
    isActive: true,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordHash,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  };
}

const PROFILE = {
  userId: "user-1",
  power: 0,
  titleHtml: null,
  bio: null,
  availabilityTimezone: null,
  vacationStart: null,
  vacationEnd: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Mock DB for the four reads a fully successful login performs: lockout row,
 * account row, profile row, then role permissions. Password-hash updates are
 * captured through `updateWhere` so the rehash write can be asserted.
 */
function createMockDb(accountRow: ReturnType<typeof account>) {
  const updateWhere = vi.fn(() => Promise.resolve());
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const select = vi.fn()
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    })
    .mockReturnValueOnce({
      from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([accountRow]) }) }) }) }),
    })
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([PROFILE]) }) }),
    })
    .mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([]) }),
    });
  const db = {
    select,
    update,
    delete: () => ({ where: () => Promise.resolve() }),
  } as never;
  return { db, update, updateSet, updateWhere };
}

function createDeps(target: number) {
  return {
    rawDb: {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: [] }) })) })),
    } as never,
    mediaService: {
      listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
    } as never,
    createPasswordHash: vi.fn().mockResolvedValue({
      passwordHash: `pbkdf2-sha256$${target}$${B64_HASH}`,
      salt: "QUFBQUFBQUFBQUFBQUFBQQ==",
    }),
    verifyPassword: vi.fn().mockResolvedValue(true),
    passwordHashTargetIterations: target,
    createSession: vi.fn().mockResolvedValue(undefined),
    destroySessionById: vi.fn().mockResolvedValue(undefined),
    enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  };
}

describe("AuthService.login rehash-on-login", () => {
  it("rehashes a legacy-strength hash to the configured target after a successful login", async () => {
    const deps = createDeps(10_000);
    const mock = createMockDb(account(`pbkdf2-sha256$600000$${B64_HASH}`));
    const service = new AuthService(mock.db, deps);

    const result = await service.login("Veteran", "correct-password", false);

    expect(result.ok).toBe(true);
    expect(deps.createPasswordHash).toHaveBeenCalledWith("correct-password");
    expect(mock.updateSet).toHaveBeenCalledWith({
      passwordHash: `pbkdf2-sha256$10000$${B64_HASH}`,
      salt: "QUFBQUFBQUFBQUFBQUFBQQ==",
    });
    expect(mock.updateWhere).toHaveBeenCalledTimes(1);
  });

  it("leaves a hash already at the target strength untouched", async () => {
    const deps = createDeps(10_000);
    const mock = createMockDb(account(`pbkdf2-sha256$10000$${B64_HASH}`));
    const service = new AuthService(mock.db, deps);

    const result = await service.login("Veteran", "correct-password", false);

    expect(result.ok).toBe(true);
    expect(deps.createPasswordHash).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });
});
