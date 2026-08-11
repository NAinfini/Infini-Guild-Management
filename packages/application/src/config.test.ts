import { describe, expect, it } from "vitest";
import { readApplicationConfig } from "./config.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("readApplicationConfig", () => {
  it("normalizes one public origin and deduplicated additional origins", () => {
    const value = readApplicationConfig({
      IG_PUBLIC_URL: "https://guild.example/",
      IG_ALLOWED_ORIGINS: "https://admin.example, https://guild.example,https://admin.example/",
      IG_INVITE_TOKEN_SECRET: SECRET,
      IG_AUDIT_DOWNLOAD_SECRET: SECRET,
    });
    expect(value).toMatchObject({
      publicUrl: "https://guild.example",
      allowedOrigins: ["https://admin.example"],
      inviteTokenSecret: SECRET,
      passwordIterations: 10_000,
    });
    expect(new TextDecoder().decode(value.auditDownloadSecret)).toBe(SECRET);
  });

  it.each([
    [{}, /IG_PUBLIC_URL is required/],
    [{ IG_PUBLIC_URL: "ftp://guild.example" }, /root HTTP\(S\) origins/],
    [{ IG_PUBLIC_URL: "https://guild.example/path" }, /root HTTP\(S\) origins/],
    [{ IG_PUBLIC_URL: "https://guild.example", IG_INVITE_TOKEN_SECRET: "short" }, /32 UTF-8 bytes/],
    [{ IG_PUBLIC_URL: "https://guild.example", IG_PBKDF2_ITERATIONS: "9999" }, /PBKDF2 iterations/],
  ] as const)("rejects invalid security configuration", (patch, expected) => {
    expect(() => readApplicationConfig({
      IG_INVITE_TOKEN_SECRET: SECRET,
      IG_AUDIT_DOWNLOAD_SECRET: SECRET,
      ...patch,
    })).toThrow(expected);
  });
});
