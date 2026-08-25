import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseEnv,
  parseJsonc,
  oauthCallbackUrls,
  RATE_LIMIT_EXPECTATIONS,
  validateCloudflareConfig,
  validateVpsConfig,
} from "./check-runtime-config.mjs";

function cloudflareConfig(): Record<string, unknown> {
  return {
    name: "guild",
    main: "src/index.ts",
    compatibility_date: "2026-08-09",
    compatibility_flags: ["nodejs_als"],
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
    ratelimits: Object.entries(RATE_LIMIT_EXPECTATIONS).map(([name, expected], index) => ({
      name,
      namespace_id: `namespace-${index}`,
      simple: { limit: expected.maxRequests, period: expected.windowMs / 1000 },
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
  it("keeps Cloudflare and E2E fixtures on the shared migration and rate-limit contract", () => {
    for (const relativePath of [
      "../apps/cloudflare/wrangler.example.jsonc",
      "./e2e/wrangler.e2e.jsonc",
    ]) {
      const config = parseJsonc(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"));
      const database = config.d1_databases.find((entry: { binding?: string }) => entry.binding === "DB");
      expect(database.migrations_dir).toBe("../../packages/persistence-sqlite/src/migrations/generated");
      for (const [name, expected] of Object.entries(RATE_LIMIT_EXPECTATIONS)) {
        expect(config.ratelimits).toContainEqual(expect.objectContaining({
          name,
          simple: {
            limit: expected.maxRequests,
            period: expected.windowMs / 1000,
          },
        }));
      }
    }
  });

  it("keeps the production template off alternate Worker hostnames", () => {
    const config = parseJsonc(readFileSync(
      fileURLToPath(new URL("../apps/cloudflare/wrangler.example.jsonc", import.meta.url)),
      "utf8",
    ));

    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ custom_domain: true }),
    ]));
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

  it("keeps Cloudflare OAuth credentials in secret storage and pairs email sender configuration", () => {
    const oauth = cloudflareConfig();
    (oauth.vars as Record<string, string>).IG_OAUTH_GOOGLE_CLIENT_ID = "google-client";
    expect(validateCloudflareConfig(oauth)).toContainEqual(expect.stringContaining("IG_OAUTH_GOOGLE_CLIENT_ID"));

    const emailFromOnly = cloudflareConfig();
    (emailFromOnly.vars as Record<string, string>).IG_EMAIL_FROM = "no-reply@example.com";
    expect(validateCloudflareConfig(emailFromOnly)).toContainEqual(expect.stringContaining("configured together"));

    const emailBindingOnly = cloudflareConfig();
    emailBindingOnly.send_email = [{ name: "EMAIL", allowed_sender_addresses: ["no-reply@example.com"] }];
    expect(validateCloudflareConfig(emailBindingOnly)).toContainEqual(expect.stringContaining("configured together"));

    const completeEmail = cloudflareConfig();
    completeEmail.send_email = [{ name: "EMAIL", allowed_sender_addresses: ["no-reply@example.com"] }];
    (completeEmail.vars as Record<string, string>).IG_EMAIL_FROM = "no-reply@example.com";
    expect(validateCloudflareConfig(completeEmail)).toEqual([]);
  });

  it("derives the exact implemented-provider callback URLs from the public origin", () => {
    expect(oauthCallbackUrls("https://guild.example")).toEqual({
      google: "https://guild.example/api/auth/oauth/google/callback",
      discord: "https://guild.example/api/auth/oauth/discord/callback",
      kook: "https://guild.example/api/auth/oauth/kook/callback",
    });
  });

  it("requires the nodejs_als compatibility flag the worker needs to load", () => {
    const config = cloudflareConfig();
    delete config.compatibility_flags;
    expect(validateCloudflareConfig(config)).toContainEqual(expect.stringContaining("nodejs_als"));
  });

  it("rejects rate limiter quotas that drift from the shared LIMITS mirror", () => {
    const config = cloudflareConfig();
    const auth = (config.ratelimits as Array<{ name: string; simple: { limit: number } }>)
      .find((entry) => entry.name === "AUTH_RATE_LIMITER")!;
    auth.simple.limit += 1;
    expect(validateCloudflareConfig(config)).toContainEqual(expect.stringContaining("must mirror shared LIMITS"));
  });

  it("holds the VPS preflight to the runtime HTTPS rule for public origins", () => {
    expect(validateVpsConfig({ ...vpsConfig(), IG_PUBLIC_URL: "http://guild.example" }))
      .toContainEqual(expect.stringContaining("HTTPS"));
    expect(validateVpsConfig({ ...vpsConfig(), IG_PUBLIC_URL: "http://localhost:8787" })).toEqual([]);
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
