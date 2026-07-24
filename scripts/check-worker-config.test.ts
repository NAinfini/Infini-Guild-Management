import { describe, expect, it } from "vitest";
import { parseJsonc, validateWorkerConfig } from "./check-worker-config.mjs";

function validConfig() {
  return {
    secrets: { required: ["SIGNING_SECRET"] },
    env: {
      production: {
        workers_dev: true,
        vars: {
          ENVIRONMENT: "production",
          SITE_NAME: "My Guild",
          SITE_LOGO_URL: "/guild-logo.webp",
          PORTAL_ORIGIN: "",
        },
        d1_databases: [{
          binding: "DB",
          database_name: "my-guild-db",
          database_id: "11111111-2222-3333-4444-555555555555",
        }],
        r2_buckets: [{
          binding: "MEDIA",
          bucket_name: "my-guild-media",
        }],
      },
    },
  };
}

describe("worker config preflight", () => {
  it("parses comments and trailing commas in JSONC", () => {
    expect(parseJsonc(`{
      // This URL must not be treated as a comment.
      "url": "https://example.com/path",
      "literal": "keep,}",
      "enabled": true,
    }`)).toEqual({
      url: "https://example.com/path",
      literal: "keep,}",
      enabled: true,
    });
  });

  it("parses UTF-8 BOM-prefixed JSONC files", () => {
    expect(parseJsonc("\uFEFF{\n  // config\n  \"enabled\": true,\n}")).toEqual({
      enabled: true,
    });
  });

  it("accepts a complete workers.dev production configuration", () => {
    expect(validateWorkerConfig(validConfig(), "production")).toEqual([]);
  });

  it("reports the exact unresolved production placeholders", () => {
    const config = validConfig();
    config.env.production.d1_databases[0]!.database_id = "YOUR_D1_DATABASE_ID";
    config.env.production.r2_buckets[0]!.bucket_name = "YOUR_R2_BUCKET_NAME";

    expect(validateWorkerConfig(config, "production")).toEqual(expect.arrayContaining([
      expect.stringContaining("YOUR_D1_DATABASE_ID"),
      expect.stringContaining("YOUR_R2_BUCKET_NAME"),
    ]));
  });

  it("requires either workers.dev or a configured route", () => {
    const config = validConfig();
    config.env.production.workers_dev = false;

    expect(validateWorkerConfig(config, "production")).toContain(
      "env.production needs workers_dev: true or a configured custom-domain route.",
    );
  });
});
