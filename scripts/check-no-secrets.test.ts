import { describe, expect, it } from "vitest";
import { findSecretLabels, isForbiddenTrackedFile } from "./check-no-secrets.mjs";

describe("secret scanner", () => {
  it("detects high-confidence tokens without returning their value", () => {
    const fakeToken = ["ghp_", "abcdefghijklmnopqrstuvwxyz", "1234567890"].join("");
    const labels = findSecretLabels(`token=${fakeToken}`);
    expect(labels).toEqual(["GitHub token"]);
    expect(JSON.stringify(labels)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("detects real secret assignments but permits documented placeholders", () => {
    expect(
      findSecretLabels('SIGNING_SECRET: "a-real-random-secret-value"')
        .includes("SIGNING_SECRET"),
    ).toBe(true);
    expect(findSecretLabels('SIGNING_SECRET: "test-secret"')).toEqual([]);
    expect(findSecretLabels('api_token = "${API_TOKEN}"')).toEqual([]);
  });

  it("forbids sensitive tracked files while allowing examples", () => {
    expect(isForbiddenTrackedFile("apps/cloudflare/.dev.vars")).toBe(true);
    expect(isForbiddenTrackedFile("apps/cloudflare/wrangler.jsonc")).toBe(true);
    expect(isForbiddenTrackedFile("apps/vps/.env")).toBe(true);
    expect(isForbiddenTrackedFile("apps/vps/private-migrations/owner.sql")).toBe(true);
    expect(isForbiddenTrackedFile("private-migrations/passwords.sql")).toBe(true);
    expect(isForbiddenTrackedFile("deploy/.env.production")).toBe(true);
    expect(isForbiddenTrackedFile("apps/other/wrangler.jsonc")).toBe(true);
    expect(isForbiddenTrackedFile("apps\\other\\wrangler.jsonc")).toBe(true);
    expect(isForbiddenTrackedFile("certs/server.key")).toBe(true);
    expect(isForbiddenTrackedFile("data/guild.sqlite-journal")).toBe(true);
    expect(isForbiddenTrackedFile("data/guild.sqlite3-wal")).toBe(true);
    expect(isForbiddenTrackedFile("data/guild.sqlite3-shm")).toBe(true);
    expect(isForbiddenTrackedFile("data/guild.db-journal")).toBe(true);
    expect(isForbiddenTrackedFile("data/guild.db3-wal")).toBe(true);
    expect(isForbiddenTrackedFile("data/guild.db3-shm")).toBe(true);
    expect(isForbiddenTrackedFile("apps/cloudflare/.dev.vars.example")).toBe(false);
    expect(isForbiddenTrackedFile("apps/cloudflare/wrangler.example.jsonc")).toBe(false);
    expect(isForbiddenTrackedFile("scripts/templates/vps.env.example")).toBe(false);
  });
});
