import { describe, expect, it } from "vitest";
import { cloudflareClientIdentifier, readCloudflareRuntimeConfig } from "./config.js";

describe("Cloudflare runtime configuration", () => {
  it("requires HTTPS except for loopback local development", () => {
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "https://guild.example",
    })).toMatchObject({ application: { publicUrl: "https://guild.example" }, localDevelopment: false });
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "http://localhost:5173",
    })).toMatchObject({ application: { publicUrl: "http://localhost:5173" }, localDevelopment: true });
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "https://localhost:8787",
    }).localDevelopment).toBe(true);
    expect(() => readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "http://guild.example",
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

  it("reads and validates public maintenance metadata", () => {
    expect(readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "https://guild.example",
      IG_MAINTENANCE_REASON: "Database maintenance",
      IG_MAINTENANCE_UNTIL: "2026-08-30T12:00:00.000Z",
    }).maintenance).toEqual({
      reason: "Database maintenance",
      until: "2026-08-30T12:00:00.000Z",
    });
    expect(() => readCloudflareRuntimeConfig({
      IG_PUBLIC_URL: "https://guild.example",
      IG_MAINTENANCE_UNTIL: "2026-08-30T12:00:00Z",
    })).toThrow(/IG_MAINTENANCE_UNTIL/);
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
