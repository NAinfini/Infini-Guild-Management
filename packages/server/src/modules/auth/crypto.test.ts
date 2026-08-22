import { describe, expect, it } from "vitest";
import {
  createInviteTokenCodec,
  createOpaqueToken,
  createPasswordHash,
  digestToken,
  PASSWORD_HASH_ITERATIONS,
  readPasswordHashIterations,
  verifyPassword,
} from "./crypto";

describe("auth crypto", () => {
  it("stores a self-describing PBKDF2 hash", async () => {
    const encoded = await createPasswordHash("correct horse battery staple");
    expect(encoded.split("$")).toHaveLength(4);
    expect(readPasswordHashIterations(encoded)).toBe(PASSWORD_HASH_ITERATIONS);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong", encoded)).resolves.toBe(false);
  });

  it("never uses the raw session token as its digest", async () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    await expect(digestToken(token)).resolves.not.toBe(token);
  });

  it("derives stable ten-character alphanumeric invite codes", async () => {
    const codec = createInviteTokenCodec("0123456789abcdef0123456789abcdef");
    const code = await codec.encode("invite-1");

    expect(code).toMatch(/^[A-Za-z0-9]{10}$/);
    await expect(codec.encode("invite-1")).resolves.toBe(code);
    await expect(codec.encode("invite-2")).resolves.not.toBe(code);
    expect(codec.normalize(` ${code} `)).toBe(code);
    expect(codec.normalize(`${code}x`)).toBeNull();
    expect(codec.normalize("not-valid")).toBeNull();
  });
});
