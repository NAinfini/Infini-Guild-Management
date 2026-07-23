import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findSecretLabels, isForbiddenTrackedFile } from "./check-no-secrets.mjs";

describe("secret scanner", () => {
  it("detects high-confidence tokens without returning their value", () => {
    const fakeToken = ["ghp_", "abcdefghijklmnopqrstuvwxyz", "1234567890"].join("");
    const labels = findSecretLabels(`token=${fakeToken}`);
    assert.deepEqual(labels, ["GitHub token"]);
    assert.equal(JSON.stringify(labels).includes("abcdefghijklmnopqrstuvwxyz"), false);
  });

  it("detects real secret assignments but permits documented placeholders", () => {
    assert.equal(
      findSecretLabels('SIGNING_SECRET: "a-real-random-secret-value"').includes("SIGNING_SECRET"),
      true,
    );
    assert.deepEqual(findSecretLabels('SIGNING_SECRET: "test-secret"'), []);
    assert.deepEqual(findSecretLabels('api_token = "${API_TOKEN}"'), []);
  });

  it("forbids sensitive tracked files while allowing examples", () => {
    assert.equal(isForbiddenTrackedFile("apps/worker/.dev.vars"), true);
    assert.equal(isForbiddenTrackedFile("deploy/.env.production"), true);
    assert.equal(isForbiddenTrackedFile("apps/worker/wrangler.jsonc"), true);
    assert.equal(isForbiddenTrackedFile("certs/server.key"), true);
    assert.equal(isForbiddenTrackedFile("apps/worker/.dev.vars.example"), false);
    assert.equal(isForbiddenTrackedFile("apps/worker/wrangler.example.jsonc"), false);
  });
});
