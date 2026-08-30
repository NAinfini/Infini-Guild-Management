import { describe, expect, it } from "vitest";
import {
  createInviteCode,
  createOpaqueToken,
  createPasswordHash,
  digestToken,
  PASSWORD_HASH_ITERATIONS,
  readPasswordHashIterations,
  normalizeInviteCode,
  verifyPassword,
  verifyPasswordWithinBudget,
} from "./crypto";

describe("auth crypto", () => {
  it("stores a self-describing PBKDF2 hash", async () => {
    const encoded = await createPasswordHash("correct horse battery staple");
    expect(encoded.split("$")).toHaveLength(4);
    expect(readPasswordHashIterations(encoded)).toBe(PASSWORD_HASH_ITERATIONS);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong", encoded)).resolves.toBe(false);
  });

  it("writes and verifies the 10,000-iteration Worker cost", async () => {
    const workerCost = "pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw";
    await expect(verifyPassword("admin123", workerCost)).resolves.toBe(true);
    await expect(createPasswordHash("admin123", 10_000)).resolves.toMatch(/^pbkdf2-sha256\$10000\$/);
  });

  it("keeps login verification within one fixed PBKDF2 budget", async () => {
    const priorCost = "pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw";
    await expect(verifyPasswordWithinBudget("admin123", priorCost)).resolves.toEqual({
      valid: true,
      iterations: 10_000,
    });
    await expect(verifyPasswordWithinBudget("admin123", "malformed")).resolves.toEqual({
      valid: false,
      iterations: null,
    });

    const aboveBudget = await createPasswordHash("password-123", PASSWORD_HASH_ITERATIONS + 1);
    await expect(verifyPasswordWithinBudget("password-123", aboveBudget)).resolves.toEqual({
      valid: false,
      iterations: null,
    });
    await expect(verifyPasswordWithinBudget(
      "password-123",
      aboveBudget,
      PASSWORD_HASH_ITERATIONS + 1,
    )).resolves.toEqual({ valid: true, iterations: PASSWORD_HASH_ITERATIONS + 1 });
  });

  it("reads iterations only from a complete canonical password hash", async () => {
    const encoded = await createPasswordHash("correct horse battery staple");
    const [prefix, iterations, salt, hash] = encoded.split("$");

    expect(readPasswordHashIterations(`${prefix}$${iterations}$AA$${hash}`)).toBeNull();
    expect(readPasswordHashIterations(`${prefix}$${iterations}$${salt}$AA`)).toBeNull();
    expect(readPasswordHashIterations(`${prefix}$10000001$${salt}$${hash}`)).toBeNull();
  });

  it("never uses the raw session token as its digest", async () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    await expect(digestToken(token)).resolves.not.toBe(token);
  });

  it("creates and normalizes exactly 10 alphanumeric invite-code characters", () => {
    const code = createInviteCode();

    expect(code).toMatch(/^[A-Z0-9]{10}$/);
    expect(normalizeInviteCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(normalizeInviteCode("not-valid")).toBeNull();
    expect(normalizeInviteCode(`${code}!`)).toBeNull();
  });
});
