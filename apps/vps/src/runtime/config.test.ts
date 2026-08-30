import path from "node:path";
import { describe, expect, it } from "vitest";
import { readVpsRuntimeConfig } from "./config.js";

const BASE = {
  IG_PUBLIC_URL: "https://guild.example",
};

describe("readVpsRuntimeConfig", () => {
  it("uses safe local paths and an exact trusted-proxy set", () => {
    /* 装载目录必须是绝对路径，具体长什么样由运行平台决定，所以用 path 现场求出来，
       而不是写死某个平台的字面量。 */
    const serviceDirectory = path.resolve("/service");
    const value = readVpsRuntimeConfig({
      ...BASE,
      IG_PORT: "4100",
      IG_TRUSTED_PROXY_IPS: "127.0.0.1,::1,::ffff:10.0.0.2",
    }, serviceDirectory);
    expect(value).toMatchObject({ host: "127.0.0.1", port: 4100 });
    expect(value.databasePath).toBe(path.join(serviceDirectory, "data", "infini-guild.sqlite"));
    expect([...value.trustedProxyAddresses]).toEqual(["127.0.0.1", "::1", "10.0.0.2"]);
  });

  it("allows HTTP only for loopback development", () => {
    expect(() => readVpsRuntimeConfig({ ...BASE, IG_PUBLIC_URL: "http://guild.example" }))
      .toThrow(/HTTPS/);
    expect(readVpsRuntimeConfig({ ...BASE, IG_PUBLIC_URL: "http://127.0.0.1:3000" }).application.publicUrl)
      .toBe("http://127.0.0.1:3000");
  });

  it("enables maintenance for on or invalid non-empty values and disables it otherwise", () => {
    for (const value of [undefined, "", " ", "off", " off "]) {
      expect(readVpsRuntimeConfig({ ...BASE, IG_MAINTENANCE_MODE: value }).maintenanceMode).toBe(false);
    }
    for (const value of ["on", " on ", "true", "invalid"]) {
      expect(readVpsRuntimeConfig({ ...BASE, IG_MAINTENANCE_MODE: value }).maintenanceMode).toBe(true);
    }
  });

  it("reads and validates public maintenance metadata", () => {
    expect(readVpsRuntimeConfig({
      ...BASE,
      IG_MAINTENANCE_REASON: " Database maintenance ",
      IG_MAINTENANCE_UNTIL: "2026-08-30T12:00:00.000Z",
    }).maintenance).toEqual({
      reason: "Database maintenance",
      until: "2026-08-30T12:00:00.000Z",
    });
    expect(() => readVpsRuntimeConfig({ ...BASE, IG_MAINTENANCE_UNTIL: "2026-08-30T12:00:00Z" }))
      .toThrow(/IG_MAINTENANCE_UNTIL/);
    expect(() => readVpsRuntimeConfig({ ...BASE, IG_MAINTENANCE_REASON: "x".repeat(501) }))
      .toThrow(/IG_MAINTENANCE_REASON/);
  });

  it("requires all Cloudflare Email Sending REST values together", () => {
    expect(() => readVpsRuntimeConfig({ ...BASE, IG_EMAIL_FROM: "no-reply@example.com" }))
      .toThrow(/must be configured together/);
    expect(() => readVpsRuntimeConfig({
      ...BASE,
      IG_CLOUDFLARE_EMAIL_ACCOUNT_ID: "account",
      IG_CLOUDFLARE_EMAIL_API_TOKEN: "token",
    })).toThrow(/must be configured together/);

    expect(readVpsRuntimeConfig({
      ...BASE,
      IG_EMAIL_FROM: "no-reply@example.com",
      IG_CLOUDFLARE_EMAIL_ACCOUNT_ID: "account",
      IG_CLOUDFLARE_EMAIL_API_TOKEN: "token",
    }).cloudflareEmail).toEqual({ accountId: "account", apiToken: "token" });
  });
});
