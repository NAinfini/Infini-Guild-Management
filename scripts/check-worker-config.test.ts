import { describe, expect, it } from "vitest";
import { parseJsonc, validateWorkerConfig } from "./check-worker-config.mjs";

function validConfig() {
  return {
    secrets: { required: ["SIGNING_SECRET"] },
    triggers: { crons: ["0 0 * * *", "*/15 * * * *"] },
    env: {
      production: {
        workers_dev: true,
        observability: {
          enabled: true,
          logs: { enabled: true, head_sampling_rate: 1 },
          traces: { enabled: true, head_sampling_rate: 0.1 },
        },
        assets: {
          directory: "../portal/dist",
          not_found_handling: "single-page-application",
          binding: "ASSETS",
          run_worker_first: true,
        },
        vars: {
          ENVIRONMENT: "production",
          SITE_NAME: "My Guild",
          SITE_LOGO_URL: "/guild-logo.webp",
          PORTAL_ORIGIN: "",
          MEDIA_ORPHAN_DELETE_MODE: "report",
          ENABLE_PRODUCTION_SYSTEM_TESTS: "false",
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
        durable_objects: {
          bindings: [{ name: "WS", class_name: "WebSocketDO" }],
        },
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

  it("requires production observability, SPA assets, WS, and both cron schedules", () => {
    const config = validConfig();
    delete config.env.production.observability;
    delete config.env.production.assets;
    delete config.env.production.durable_objects;
    delete config.env.production.vars.MEDIA_ORPHAN_DELETE_MODE;
    delete config.env.production.vars.ENABLE_PRODUCTION_SYSTEM_TESTS;
    config.triggers.crons = ["0 0 * * *"];

    expect(validateWorkerConfig(config, "production")).toEqual(expect.arrayContaining([
      expect.stringContaining("observability.logs"),
      expect.stringContaining("observability.traces"),
      expect.stringContaining("SPA assets"),
      expect.stringContaining('Durable Object binding "WS"'),
      expect.stringContaining("MEDIA_ORPHAN_DELETE_MODE"),
      expect.stringContaining("ENABLE_PRODUCTION_SYSTEM_TESTS"),
      expect.stringContaining("*/15 * * * *"),
    ]));
  });
});
