import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseEnv,
  parseJsonc,
  validateCloudflareConfig,
  validateVpsConfig,
} from "./check-runtime-config.mjs";

function cloudflareConfig(): Record<string, unknown> {
  return {
    name: "guild",
    main: "src/index.ts",
    compatibility_date: "2026-08-09",
    workers_dev: true,
    assets: {
      directory: "../portal/dist",
      binding: "ASSETS",
      html_handling: "none",
      not_found_handling: "none",
      run_worker_first: true,
    },
    d1_databases: [{
      binding: "DB",
      database_name: "guild-db",
      database_id: "real-database-id",
      migrations_dir: "../../packages/persistence-sqlite/src/migrations/generated",
      remote: false,
    }],
    r2_buckets: [{ binding: "BLOBS", bucket_name: "guild-blobs", remote: false }],
    durable_objects: {
      bindings: [{ name: "NOTIFICATIONS", class_name: "CloudflareNotificationDurableObject" }],
    },
    migrations: [{ tag: "notifications-v1", new_sqlite_classes: ["CloudflareNotificationDurableObject"] }],
    ratelimits: [
      "AUTH_RATE_LIMITER",
      "READ_RATE_LIMITER",
      "MUTATION_RATE_LIMITER",
      "UPLOAD_RATE_LIMITER",
      "WEBSOCKET_RATE_LIMITER",
    ].map((name, index) => ({
      name,
      namespace_id: `namespace-${index}`,
      simple: { limit: 10, period: 60 },
    })),
    triggers: { crons: ["*/15 * * * *", "0 0 * * *"] },
    vars: {
      IG_PUBLIC_URL: "https://guild.example",
      IG_ALLOWED_ORIGINS: "https://admin.guild.example",
      IG_SESSION_COOKIE_NAME: "ig_session",
      IG_PBKDF2_ITERATIONS: "10000",
    },
  };
}

function vpsConfig(): Record<string, string> {
  return {
    IG_PUBLIC_URL: "https://guild.example",
    IG_INVITE_TOKEN_SECRET: "i".repeat(32),
    IG_AUDIT_DOWNLOAD_SECRET: "a".repeat(32),
    IG_PBKDF2_ITERATIONS: "10000",
    IG_DATABASE_PATH: "data/infini-guild.sqlite",
    IG_BLOB_PATH: "data/blobs",
    IG_STATIC_PATH: "apps/portal/dist",
  };
}

describe("dual-runtime config preflight", () => {
  it("keeps Cloudflare and E2E fixtures on the shared migration directory", () => {
    for (const relativePath of [
      "../apps/cloudflare/wrangler.example.jsonc",
      "./e2e/wrangler.e2e.jsonc",
    ]) {
      const config = parseJsonc(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"));
      const database = config.d1_databases.find((entry: { binding?: string }) => entry.binding === "DB");
      expect(database.migrations_dir).toBe("../../packages/persistence-sqlite/src/migrations/generated");
    }
  });

  it("parses JSONC and dotenv templates without corrupting URLs", () => {
    expect(parseJsonc('{ // comment\n "url": "https://example.com",\n}')).toEqual({
      url: "https://example.com",
    });
    expect(parseEnv("# comment\nIG_PUBLIC_URL=https://example.com\nIG_PORT='8787'\n")).toEqual({
      IG_PUBLIC_URL: "https://example.com",
      IG_PORT: "8787",
    });
  });

  it("accepts complete Cloudflare and VPS configurations", () => {
    expect(validateCloudflareConfig(cloudflareConfig())).toEqual([]);
    expect(validateVpsConfig(vpsConfig())).toEqual([]);

    const localCloudflare = cloudflareConfig();
    (localCloudflare.vars as Record<string, string>).IG_PUBLIC_URL = "http://localhost:5173";
    expect(validateCloudflareConfig(localCloudflare)).toEqual([]);

    const insecureRemoteCloudflare = cloudflareConfig();
    (insecureRemoteCloudflare.vars as Record<string, string>).IG_PUBLIC_URL = "http://guild.example";
    expect(validateCloudflareConfig(insecureRemoteCloudflare)).toContainEqual(expect.stringContaining("HTTPS"));
  });

  it("requires every Cloudflare binding including the read limiter and keeps secrets out of vars", () => {
    const config = cloudflareConfig();
    config.ratelimits = (config.ratelimits as unknown[]).filter(
      (entry) => (entry as { name: string }).name !== "READ_RATE_LIMITER",
    );
    (config.vars as Record<string, string>).IG_INVITE_TOKEN_SECRET = "x".repeat(32);

    expect(validateCloudflareConfig(config)).toEqual(expect.arrayContaining([
      expect.stringContaining("READ_RATE_LIMITER"),
      expect.stringContaining("IG_INVITE_TOKEN_SECRET"),
    ]));
  });

  it("rejects local Cloudflare configurations that can reach remote D1 or R2", () => {
    const config = cloudflareConfig();
    (config.d1_databases as Array<Record<string, unknown>>)[0]!.remote = true;
    (config.r2_buckets as Array<Record<string, unknown>>)[0]!.remote = true;

    expect(validateCloudflareConfig(config)).toEqual(expect.arrayContaining([
      expect.stringContaining("cloudflare.DB.remote"),
      expect.stringContaining("cloudflare.BLOBS.remote"),
    ]));
  });

  it("requires Cloudflare to consume the shared ordered migration directory", () => {
    const config = cloudflareConfig();
    (config.d1_databases as Array<Record<string, unknown>>)[0]!.migrations_dir = "db/migrations";
    expect(validateCloudflareConfig(config)).toContainEqual(expect.stringContaining("migrations_dir"));
  });

  it("enforces the shared PBKDF2 floor/default and 10M ceiling", () => {
    for (const iterations of ["9999", "10000001", "not-a-number"]) {
      const cloudflare = cloudflareConfig();
      (cloudflare.vars as Record<string, string>).IG_PBKDF2_ITERATIONS = iterations;
      expect(validateCloudflareConfig(cloudflare)).toContainEqual(expect.stringContaining("IG_PBKDF2_ITERATIONS"));
      expect(validateVpsConfig({ ...vpsConfig(), IG_PBKDF2_ITERATIONS: iterations }))
        .toContainEqual(expect.stringContaining("IG_PBKDF2_ITERATIONS"));
    }
    expect(validateVpsConfig({ ...vpsConfig(), IG_PBKDF2_ITERATIONS: "10000000" })).toEqual([]);
  });

  it("rejects missing VPS storage paths and short production secrets", () => {
    const config = vpsConfig();
    delete config.IG_BLOB_PATH;
    config.IG_INVITE_TOKEN_SECRET = "short";
    expect(validateVpsConfig(config)).toEqual(expect.arrayContaining([
      expect.stringContaining("IG_BLOB_PATH"),
      expect.stringContaining("IG_INVITE_TOKEN_SECRET"),
    ]));
  });
});
