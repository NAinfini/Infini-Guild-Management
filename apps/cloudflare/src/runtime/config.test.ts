import { describe, expect, it } from "vitest";
import { cloudflareClientIdentifier, readCloudflareRuntimeConfig } from "./config.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("Cloudflare runtime configuration", () => {
  it("requires HTTPS except for loopback local development", () => {
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "https://guild.example",
      IG_INVITE_TOKEN_SECRET: SECRET,
      IG_AUDIT_DOWNLOAD_SECRET: SECRET,
    })).toMatchObject({ application: { publicUrl: "https://guild.example" }, localDevelopment: false });
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "http://localhost:5173",
      IG_INVITE_TOKEN_SECRET: SECRET,
      IG_AUDIT_DOWNLOAD_SECRET: SECRET,
    })).toMatchObject({ application: { publicUrl: "http://localhost:5173" }, localDevelopment: true });
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "https://localhost:8787",
      IG_INVITE_TOKEN_SECRET: SECRET,
      IG_AUDIT_DOWNLOAD_SECRET: SECRET,
    }).localDevelopment).toBe(true);
    expect(() => readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "http://guild.example",
      IG_INVITE_TOKEN_SECRET: SECRET,
      IG_AUDIT_DOWNLOAD_SECRET: SECRET,
    })).toThrow(/HTTPS/);
  });

  it("trusts only one platform-owned CF-Connecting-IP value", () => {
    expect(cloudflareClientIdentifier(new Request("https://guild.example", {
      headers: { "CF-Connecting-IP": "2001:DB8::1" },
    }))).toBe("2001:db8::1");
    expect(() => cloudflareClientIdentifier(new Request("https://guild.example", {
      headers: { "CF-Connecting-IP": "203.0.113.4, 1.1.1.1" },
    }))).toThrow(/client address/);
  });

  it("uses a fixed loopback identity only in explicit local mode", () => {
    const request = new Request("https://guild.example");
    expect(cloudflareClientIdentifier(request, true)).toBe("127.0.0.1");
    expect(() => cloudflareClientIdentifier(request)).toThrow(/client address/);
    expect(() => cloudflareClientIdentifier(new Request("https://guild.example", {
      headers: { "CF-Connecting-IP": "spoofed" },
    }), true)).toThrow(/client address/);
  });
});
