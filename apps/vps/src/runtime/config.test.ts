import path from "node:path";
import { describe, expect, it } from "vitest";
import { readVpsRuntimeConfig } from "./config.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const BASE = {
  IG_PUBLIC_URL: "https://guild.example",
  IG_INVITE_TOKEN_SECRET: SECRET,
  IG_AUDIT_DOWNLOAD_SECRET: SECRET,
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
});
