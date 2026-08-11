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

  it("rejects a modified deterministic invite token", async () => {
    const codec = createInviteTokenCodec("0123456789abcdef0123456789abcdef");
    const token = await codec.encode("invite-1");
    await expect(codec.decode(token)).resolves.toBe("invite-1");
    await expect(codec.decode(`${token}x`)).resolves.toBeNull();
  });
});
