import { describe, expect, it } from "vitest";
import { verifyPassword } from "../modules/auth/crypto";
import { convertLegacyWorkerPasswordHash } from "./auth-password-hash";

const PASSWORD = "correct horse battery staple";
const SALT = "ABEiM0RVZneImaq7zN3u/w==";
const HASH = "EmkuNs85llMvx54FsKZiwKLn4lfvjY7uswwxuzCil0c=";

describe("legacy Worker password-hash migration", () => {
  it("converts a known legacy vector into the self-contained runtime format", async () => {
    const converted = convertLegacyWorkerPasswordHash({
      passwordHash: `pbkdf2-sha256$10000$${HASH}`,
      salt: SALT,
    });
    expect(converted).toBe("pbkdf2-sha256$10000$ABEiM0RVZneImaq7zN3u_w$EmkuNs85llMvx54FsKZiwKLn4lfvjY7uswwxuzCil0c");
    await expect(verifyPassword(PASSWORD, converted)).resolves.toBe(true);
    await expect(verifyPassword("wrong", converted)).resolves.toBe(false);
  });

  it.each([
    { passwordHash: `sha256$10000$${HASH}`, salt: SALT },
    { passwordHash: `pbkdf2-sha256$9999$${HASH}`, salt: SALT },
    { passwordHash: `pbkdf2-sha256$999$${HASH}`, salt: SALT },
    { passwordHash: `pbkdf2-sha256$10000$${HASH.slice(0, -1)}`, salt: SALT },
    { passwordHash: `pbkdf2-sha256$10000$${HASH}`, salt: SALT.slice(0, -2) },
    { passwordHash: "pbkdf2-sha256$10000$YQ==", salt: SALT },
    { passwordHash: `pbkdf2-sha256$10000$${HASH}`, salt: "YQ==" },
  ])("rejects malformed legacy credentials", (input) => {
    expect(() => convertLegacyWorkerPasswordHash(input)).toThrow();
  });
});
