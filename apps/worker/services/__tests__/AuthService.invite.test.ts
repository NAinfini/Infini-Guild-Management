import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../AuthService";

function createMockDb(usernameExists = false) {
  const limit = vi.fn().mockResolvedValue(usernameExists ? [{ id: "existing-user" }] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as never;
}

function createMockDeps(inviteChanges: number) {
  return {
    rawDb: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn().mockResolvedValue({ meta: { changes: inviteChanges } }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        })),
      })),
      batch: vi.fn().mockResolvedValue([]),
    } as never,
    createPasswordHash: vi.fn().mockResolvedValue({ passwordHash: "hash", salt: "salt" }),
    verifyPassword: vi.fn(),
    createSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AuthService.register invite redemption", () => {
  it("rejects unavailable invite (exhausted, revoked, expired, or nonexistent)", async () => {
    const service = new AuthService(createMockDb(), createMockDeps(0));
    const result = await service.register("ANY-BAD-CODE", "newuser", "password123");
    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Invite link is no longer available" });
  });

  it("rejects duplicate username before checking invite", async () => {
    const deps = createMockDeps(1);
    const service = new AuthService(createMockDb(true), deps);
    const result = await service.register("VALID-CODE", "taken-name", "password123");
    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Username already taken" });
    expect((deps.rawDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled();
  });
});
