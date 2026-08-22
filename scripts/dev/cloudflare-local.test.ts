import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cloudflareMediaBindings,
  cloudflareMediaSeedArguments,
  deriveLocalStateVersion,
  cloudflareLocalPaths,
  parseCloudflareLocalAction,
  wranglerArguments,
} from "./cloudflare-local.mjs";

const checksum = "a".repeat(64);
const root = resolve("C:/workspace/infini-guild");
const paths = Object.freeze({
  cloudflareDirectory: resolve(root, "apps/cloudflare"),
  configPath: resolve(root, "apps/cloudflare/wrangler.jsonc"),
  seedPath: resolve(root, "scripts/dev/seed.sql"),
  statePath: resolve(root, "apps/cloudflare/.wrangler/local-state/state-version"),
  stateVersion: "state-version",
});

describe("Cloudflare local development state", () => {
  it("derives one deterministic state version from the ordered migration manifest", () => {
    const manifest = [{ id: "0000_core", ordinal: 0, checksum }];
    expect(deriveLocalStateVersion(manifest)).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveLocalStateVersion(manifest)).toBe(deriveLocalStateVersion(manifest));
    expect(deriveLocalStateVersion([{ ...manifest[0], checksum: "b".repeat(64) }]))
      .not.toBe(deriveLocalStateVersion(manifest));
    expect(() => deriveLocalStateVersion([{ id: "0001_gap", ordinal: 1, checksum }]))
      .toThrow(/entry 0 is invalid/i);
  });

  it("keeps the Windows persistence path bounded while retaining the full version", async () => {
    const resolved = await cloudflareLocalPaths();
    expect(resolved.stateVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(basename(resolved.statePath)).toBe(resolved.stateVersion.slice(0, 16));
  });

  it("uses the same absolute state and config paths for migration, seed, and serve", () => {
    const migrate = wranglerArguments("migrate", paths);
    const seed = wranglerArguments("seed", paths);
    const serve = wranglerArguments("serve", paths);
    for (const args of [migrate, seed, serve]) {
      expect(args).toContain("--local");
      expect(args.slice(args.indexOf("--persist-to"), args.indexOf("--persist-to") + 2))
        .toEqual(["--persist-to", paths.statePath]);
      expect(args.slice(args.indexOf("--config"), args.indexOf("--config") + 2))
        .toEqual(["--config", paths.configPath]);
      expect(args).not.toContain("--remote");
    }
    expect(seed).toContain(paths.seedPath);
    expect(serve).toContain("8787");
  });

  it("pins Wrangler's local request URL and application origins to loopback", () => {
    const serve = wranglerArguments("serve", paths);

    expect(serve.slice(serve.indexOf("--host"), serve.indexOf("--host") + 2))
      .toEqual(["--host", "127.0.0.1"]);
    expect(serve.filter((argument) => argument === "--var")).toHaveLength(2);
    expect(serve).toEqual(expect.arrayContaining([
      "IG_PUBLIC_URL:http://localhost:5173",
      "IG_ALLOWED_ORIGINS:http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1",
    ]));
  });

  it("passes the configured local D1 and R2 identifiers to the fixture repairer", async () => {
    const media = await cloudflareMediaSeedArguments({
      ...paths,
      configPath: resolve(process.cwd(), "apps/cloudflare/wrangler.example.jsonc"),
    }, root);
    expect(media).toEqual([
      resolve(root, "node_modules/tsx/dist/cli.mjs"),
      resolve(root, "apps/cloudflare/scripts/seed-local-media.ts"),
      "--persist-to",
      paths.statePath,
      "--database-id",
      "00000000-0000-0000-0000-000000000000",
      "--bucket-name",
      "replace-with-r2-bucket-name",
    ]);
    expect(media).not.toContain("--remote");
  });

  it("requires exactly one DB and BLOBS binding", () => {
    const config = {
      d1_databases: [{ binding: "DB", database_id: "database-id" }],
      r2_buckets: [{ binding: "BLOBS", bucket_name: "bucket-name" }],
    };
    expect(cloudflareMediaBindings(config)).toEqual({
      databaseId: "database-id",
      bucketName: "bucket-name",
    });
    expect(() => cloudflareMediaBindings({
      ...config,
      d1_databases: [...config.d1_databases, ...config.d1_databases],
    })).toThrow(/exactly one.*DB/i);
    expect(() => cloudflareMediaBindings({ ...config, r2_buckets: [] }))
      .toThrow(/exactly one.*BLOBS/i);
  });

  it("accepts only the three explicit local actions", () => {
    expect(parseCloudflareLocalAction(["migrate"])).toBe("migrate");
    expect(parseCloudflareLocalAction(["seed"])).toBe("seed");
    expect(parseCloudflareLocalAction(["serve"])).toBe("serve");
    expect(() => parseCloudflareLocalAction(["deploy"])).toThrow(/migrate\|seed\|serve/i);
  });
});
