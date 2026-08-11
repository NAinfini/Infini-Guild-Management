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
    const value = readVpsRuntimeConfig({
      ...BASE,
      IG_PORT: "4100",
      IG_TRUSTED_PROXY_IPS: "127.0.0.1,::1,::ffff:10.0.0.2",
    }, "C:/service");
    expect(value).toMatchObject({ host: "127.0.0.1", port: 4100 });
    expect(value.databasePath.replaceAll("\\", "/")).toBe("C:/service/data/infini-guild.sqlite");
    expect([...value.trustedProxyAddresses]).toEqual(["127.0.0.1", "::1", "10.0.0.2"]);
  });

  it("allows HTTP only for loopback development", () => {
    expect(() => readVpsRuntimeConfig({ ...BASE, IG_PUBLIC_URL: "http://guild.example" }))
      .toThrow(/HTTPS/);
    expect(readVpsRuntimeConfig({ ...BASE, IG_PUBLIC_URL: "http://127.0.0.1:3000" }).application.publicUrl)
      .toBe("http://127.0.0.1:3000");
  });
});
