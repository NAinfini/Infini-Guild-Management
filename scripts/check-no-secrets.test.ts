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
      findSecretLabels('IG_INVITE_TOKEN_SECRET: "a-real-random-secret-value"')
        .includes("IG_INVITE_TOKEN_SECRET"),
    ).toBe(true);
    expect(findSecretLabels('IG_INVITE_TOKEN_SECRET: "test-secret"')).toEqual([]);
    expect(findSecretLabels('api_token = "${API_TOKEN}"')).toEqual([]);
  });

  it("forbids sensitive tracked files while allowing examples", () => {
    expect(isForbiddenTrackedFile("apps/cloudflare/.dev.vars")).toBe(true);
    expect(isForbiddenTrackedFile("apps/cloudflare/wrangler.jsonc")).toBe(true);
    expect(isForbiddenTrackedFile("apps/vps/.env")).toBe(true);
    expect(isForbiddenTrackedFile("apps/vps/private-migrations/owner.sql")).toBe(true);
    expect(isForbiddenTrackedFile("private-migrations/legacy-passwords.sql")).toBe(true);
    expect(isForbiddenTrackedFile("deploy/.env.production")).toBe(true);
    expect(isForbiddenTrackedFile("apps/other/wrangler.jsonc")).toBe(true);
    expect(isForbiddenTrackedFile("apps\\other\\wrangler.jsonc")).toBe(true);
    expect(isForbiddenTrackedFile("certs/server.key")).toBe(true);
    expect(isForbiddenTrackedFile("apps/cloudflare/.dev.vars.example")).toBe(false);
    expect(isForbiddenTrackedFile("apps/cloudflare/wrangler.example.jsonc")).toBe(false);
    expect(isForbiddenTrackedFile("scripts/templates/vps.env.example")).toBe(false);
  });
});
